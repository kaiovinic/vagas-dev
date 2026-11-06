import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import {
  OPERATIONAL_ALERTER,
  type IOperationalAlerter,
} from '@/domain/providers/operational-alerter';
import {
  SOURCE_LAST_RUN_READER,
  type ISourceLastRunReader,
} from '@/domain/repositories/source-health-repository';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  activityIdFromUrl,
  decodePostTimestamp,
} from '@/infra/scrapers/support/linkedin-post';
import { collapseSpaces } from '@/infra/scrapers/support/scraper-helpers';

export const LINKEDIN_AUTH_POSTS_SOURCE = 'linkedin-auth-posts';

/** Caminho do cache de colheita no worker. */
export const HARVEST_PATH = '/posts';

const REQUEST_TIMEOUT_IN_MS = 5_000;

const TITLE_MAX_LENGTH = 140;

/**
 * Estados possiveis da colheita, espelhando `HarvestFile` do
 * `@devradar/posts-worker`.
 *
 * Os dois lados mantem copias independentes destes tipos de proposito: o worker
 * nao deve nada ao Nest nem ao Prisma, e a API nao depende do Playwright. O
 * preco e manter as copias de acordo, e e por isso que este provider le o corpo
 * defensivamente — um worker de versao antiga e um formato inesperado como
 * qualquer outro.
 */
const HARVEST_STATUSES = ['ok', 'degraded', 'session-lost', 'never-ran'] as const;

type HarvestStatus = (typeof HARVEST_STATUSES)[number];

/** Uma publicacao do worker, ja validada. */
interface HarvestedPost {
  readonly url: string;
  readonly author: string;
  readonly text: string;
  readonly links: readonly string[];
}

interface Harvest {
  /** `null` apenas com `never-ran`. */
  readonly harvestedAt: Date | null;
  readonly status: HarvestStatus;
  readonly posts: readonly HarvestedPost[];
}

/**
 * Coletor de publicacoes do LinkedIn pela sessao autenticada (RFC 001).
 *
 * Nao abre navegador: quem navega e o `apps/posts-worker`, que roda em imagem
 * propria porque o Chromium do Playwright nao sobe na Alpine da API. Aqui o
 * coletor e so mais um cliente HTTP, como as outras sete fontes, e por isso
 * entra no `JOB_SCRAPERS` sem o orquestrador mudar (OCP).
 *
 * A leitura e de um cache: o worker colhe no proprio cron, de 8 em 8 horas, e o
 * `GET /posts` devolve a ultima colheita na hora, sem navegar. Um Chromium
 * preso em espera de seletor nao pode segurar a captura das outras fontes.
 *
 * Sem `LINKEDIN_POSTS_WORKER_URL` o coletor e um no-op silencioso, no mesmo
 * padrao da `SERP_API_KEY`: ambiente sem a variavel simplesmente nao tem a
 * fonte, e nada mais quebra.
 */
@Injectable()
export class LinkedinAuthPostsScraperProvider extends BaseScraperProvider {
  readonly source = LINKEDIN_AUTH_POSTS_SOURCE;
  readonly label = 'Publicacoes do LinkedIn (sessao)';

  /**
   * Se o alerta de sessao caida ja saiu.
   *
   * Em memoria de proposito: o pior caso de um restart e um alerta repetido, e
   * um alerta repetido e muito menos grave que uma coluna no banco para
   * controlar aviso.
   */
  private sessionLossAlerted = false;

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Inject(SOURCE_LAST_RUN_READER) private readonly lastRun: ISourceLastRunReader,
    @Inject(OPERATIONAL_ALERTER) private readonly alerter: IOperationalAlerter,
    @Optional() private readonly workerUrl: string = readWorkerUrlFromEnv(),
  ) {
    super();
  }

  /**
   * Pronto so quando ha colheita NOVA — e e isto que faz a tabela de saude
   * dizer a verdade.
   *
   * Ler o cache e gratuito, entao a tentacao e ler em toda captura. Mas cada
   * leitura vira uma execucao em `capture_source_logs`, e o painel passaria a
   * anunciar "ultima captura: agora" para uma colheita de sete horas atras. A
   * fonte so se declara pronta quando o `harvestedAt` do worker e mais recente
   * que a ultima execucao registrada; assim `lastRunAt` passa a significar
   * "ultima colheita nova", com no maximo um ciclo de captura de atraso.
   *
   * O `reference` nao e usado: quem define a idade aqui e o worker, nao o
   * relogio de quem pergunta.
   */
  override async isDue(_reference: Date): Promise<boolean> {
    const harvest = await this.readHarvest();

    if (harvest === undefined) {
      return false;
    }

    // Sessao caida ainda precisa de uma execucao, senao o alerta nunca sai.
    // Depois que ele saiu, parar de insistir evita encher a tabela de saude de
    // execucoes que nao colheram nada.
    if (harvest.status === 'session-lost') {
      return !this.sessionLossAlerted;
    }

    if (harvest.harvestedAt === null) {
      return false;
    }

    const lastRunAt = await this.lastRun.getLastRunAt(this.source);

    return lastRunAt === null || harvest.harvestedAt.getTime() > lastRunAt.getTime();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const harvest = await this.readHarvest();

    if (harvest === undefined) {
      return [];
    }

    await this.reactToStatus(harvest);

    if (harvest.harvestedAt === null) {
      this.logger.debug('Worker ainda nao colheu nada');

      return [];
    }

    return harvest.posts.flatMap((post) => this.toRawJob(post));
  }

  /**
   * Sessao caida nao interrompe nada: avisa e segue entregando a colheita
   * preservada, que a janela de 72h do motor de regras faz secar sozinha em
   * tres dias — em vez de a fonte sumir de uma vez.
   */
  private async reactToStatus(harvest: Harvest): Promise<void> {
    if (harvest.status !== 'session-lost') {
      this.sessionLossAlerted = false;

      return;
    }

    this.logger.warn('Sessao do LinkedIn caiu no worker de publicacoes');

    if (this.sessionLossAlerted) {
      return;
    }

    this.sessionLossAlerted = true;
    await this.sendSessionLossAlert();
  }

  /** O alerta nao pode derrubar a captura: a falha fica no log e a vida segue. */
  private async sendSessionLossAlert(): Promise<void> {
    try {
      await this.alerter.notifyOperational({
        source: this.source,
        title: 'Sessao do LinkedIn caiu',
        detail:
          'O worker de publicacoes perdeu o login e esta servindo a ultima colheita, ' +
          'que vence em 72h. Nenhuma publicacao nova vai entrar ate a sessao voltar.',
        action:
          'Renove a sessao com `npm run session:login --workspace @devradar/posts-worker` ' +
          'e confirme com `session:check`.',
      });
    } catch (error: unknown) {
      this.logger.warn(`Alerta de sessao caida nao saiu: ${describeError(error)}`);
    }
  }

  /**
   * `undefined` quando o worker nao respondeu ou respondeu o que nao se
   * entende. Nunca lanca: `isDue` e chamado em paralelo para todas as fontes, e
   * uma excecao aqui derrubaria a captura inteira.
   */
  private async readHarvest(): Promise<Harvest | undefined> {
    if (!this.isConfigured()) {
      this.logger.debug('Worker nao configurado: coletor de publicacoes logadas ignorado');

      return undefined;
    }

    try {
      const { body } = await this.http.get<unknown>(`${this.workerUrl}${HARVEST_PATH}`, {
        headers: { Accept: 'application/json' },
        timeoutInMs: REQUEST_TIMEOUT_IN_MS,
      });

      return parseHarvest(body);
    } catch (error: unknown) {
      this.logger.warn(`Worker de publicacoes indisponivel: ${describeError(error)}`);

      return undefined;
    }
  }

  /**
   * A data vem do snowflake embutido na URL, com precisao de minutos.
   *
   * Publicacao cuja URL nao carrega o id e DESCARTADA, e nao carimbada com o
   * instante da captura: em janela de 72h, data aproximada erra por horas e e
   * pior que uma vaga a menos.
   */
  private toRawJob(post: HarvestedPost): RawJobProps[] {
    const activityId = activityIdFromUrl(post.url);
    const publishedAt = activityId === undefined ? undefined : decodePostTimestamp(activityId);

    if (publishedAt === undefined) {
      return [];
    }

    return [
      {
        title: truncate(post.text, TITLE_MAX_LENGTH),
        // Quem publica e a pessoa, nao a empresa: o nome dela e o unico
        // identificador confiavel, e e o que alimenta a deduplicacao.
        company: post.author,
        source: this.source,
        url: post.url,
        publishedAt,
        publishedAtSource: 'SOURCE',
        // Declara a origem: o motor exige marcador de anuncio em post social.
        origin: 'SOCIAL_POST',
        description: buildDescription(post),
        location: '',
        workModel: 'UNKNOWN',
        recruiterName: post.author,
      },
    ];
  }

  private isConfigured(): boolean {
    return this.workerUrl.length > 0;
  }
}

/**
 * Texto da publicacao e, abaixo, os links que ela aponta.
 *
 * Os links entram na descricao porque e ali que o motor de regras e a tela os
 * veem. Para o motor valem como indicio de anuncio real: curso e propaganda de
 * curriculo raramente apontam para formulario de candidatura.
 */
function buildDescription(post: HarvestedPost): string {
  if (post.links.length === 0) {
    return post.text;
  }

  return [post.text, '', ...post.links].join('\n');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function parseHarvest(body: unknown): Harvest | undefined {
  const payload = asRecord(body);
  const status = readStatus(payload?.status);

  if (payload === undefined || status === undefined) {
    return undefined;
  }

  return {
    harvestedAt: readDate(payload.harvestedAt),
    status,
    posts: readPosts(payload.posts),
  };
}

function readStatus(value: unknown): HarvestStatus | undefined {
  return HARVEST_STATUSES.find((status) => status === value);
}

function readPosts(value: unknown): HarvestedPost[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => readPost(entry));
}

/**
 * Publicacao sem URL ou sem texto nao e aproveitavel, e nao e erro: o worker ja
 * conta o que descartou, e o que chega aqui torto vem de versao diferente dele.
 */
function readPost(value: unknown): HarvestedPost[] {
  const entry = asRecord(value);
  const url = readString(entry?.url);
  const author = collapseSpaces(readString(entry?.author));
  const text = collapseSpaces(readString(entry?.text));

  if (url.length === 0 || author.length === 0 || text.length === 0) {
    return [];
  }

  return [{ url, author, text, links: readStringList(entry?.links) }];
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => readString(entry)).filter((entry) => entry.length > 0);
}

function readDate(value: unknown): Date | null {
  const raw = readString(value);

  if (raw.length === 0) {
    return null;
  }

  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readWorkerUrlFromEnv(): string {
  return (process.env.LINKEDIN_POSTS_WORKER_URL ?? '').replace(/\/$/, '');
}
