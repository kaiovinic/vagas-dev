import { Inject, Injectable, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import {
  SOURCE_LAST_RUN_READER,
  type ISourceLastRunReader,
} from '@/domain/repositories/source-health-repository';
import { BNE_INTERVAL_IN_HOURS } from '@/domain/services/source-cadence';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import { looksLikeDeveloperRole } from '@/infra/scrapers/support/developer-role-hints';
import { jobPostingFrom } from '@/infra/scrapers/support/job-posting-json-ld';
import {
  collapseSpaces,
  createPacer,
  dedupeByUrl,
  htmlToText,
  parseDate,
  toAbsoluteUrl,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

const BNE_ORIGIN = 'https://www.bne.com.br';

/**
 * O site fica atras do WAF da GoCache, que responde 403 a cliente sem
 * User-Agent de navegador. Nao e desafio de Cloudflare: com o cabecalho, a
 * pagina vem renderizada no servidor e completa, e o `robots.txt` do site
 * bloqueia apenas `/api/`, `/curriculo` e `/WebServices/` — nunca a busca nem
 * a pagina da vaga.
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Mesmo ritmo da InHire: endpoint publico, o que se protege e o IP da VPS. */
export const BNE_REQUEST_DELAY_IN_MS = 1_500;

/**
 * Teto de detalhes por ciclo.
 *
 * As seis buscas padrao devolvem 20 cards cada, e o site renomeia o titulo de
 * todos para a funcao buscada — ou seja, o recorte de cargo aprova quase tudo
 * e o ciclo tem ~120 candidatas. O teto e esse numero de proposito: cortar
 * mais baixo descartaria candidata por ordem de chegada, e como a listagem NAO
 * e ordenada por data, a cortada poderia ser justamente a vaga nova. Sao tres
 * minutos de fila no ritmo acima, duas vezes por dia.
 */
export const BNE_MAX_DETAILS_PER_CYCLE = 120;

/** Uma pagina de busca do site: funcao, cidade opcional e filtro de modalidade. */
export interface BneSearch {
  /** Slug da funcao, como o site publica em `/vagas-de-emprego-para-<funcao>`. */
  readonly role: string;
  /** Slug `cidade-uf`; ausente significa busca nacional. */
  readonly city?: string;
  /** `?HomeOffice=True`, o unico filtro de modalidade que a busca aceita. */
  readonly homeOffice?: boolean;
}

/**
 * Buscas padrao: o recorte do radar (Bahia ou 100% remoto) feito na propria url.
 *
 * O BNE nao tem pagina de estado — so de cidade — e o parametro `CityName` e
 * descartado por redirect 301. Por isso a Bahia entra por Salvador, cuja
 * listagem ja traz os municipios vizinhos (Camacari, Santo Amaro, Lauro de
 * Freitas) junto com a capital, e nao cidade por cidade.
 *
 * As funcoes sao as que existem no site: `desenvolvedor-front-end`,
 * `-back-end`, `-web` e `-react` respondem 302 — nao ha slug por stack.
 * `analista-de-sistemas` existe e responde, mas ficou fora: o site renomeia o
 * titulo de todo card para a funcao da busca, e os 20 primeiros resultados em
 * Salvador se chamavam todos "Analista De Sistemas" — nenhum passaria pelo
 * recorte de cargo, entao seria uma requisicao por ciclo para nada.
 */
export const BNE_DEFAULT_SEARCHES: readonly BneSearch[] = [
  { role: 'desenvolvedor', city: 'salvador-ba' },
  { role: 'desenvolvedor-full-stack', city: 'salvador-ba' },
  { role: 'programador', city: 'salvador-ba' },
  { role: 'desenvolvedor', homeOffice: true },
  { role: 'desenvolvedor-full-stack', homeOffice: true },
  { role: 'programador', homeOffice: true },
];

/** Vaga que passou pelo recorte de cargo e merece uma requisicao de detalhe. */
interface BneCandidate {
  readonly url: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly workModelText: string;
  readonly summary: string;
}

type HtmlNodes = ReturnType<cheerio.CheerioAPI>;
type Clock = () => Date;
type Pace = () => Promise<void>;

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;

/**
 * Coletor do BNE, o Banco Nacional de Empregos (HTML renderizado no servidor,
 * lido com cheerio).
 *
 * ATENCAO — a fonte esta FORA do registro (`infra.module.ts`). O motivo nao e
 * tecnico: o site cobra para se candidatar. Cada card declara o tipo da
 * candidatura, e a conta de 21/11/2026 foi esta:
 *
 *   busca                          | livre | exige Plano VIP
 *   desenvolvedor Salvador/BA      |     0 |              20
 *   idem, home office              |     0 |              20
 *   desenvolvedor full stack (BR)  |     1 |              19
 *
 * Ou seja, nenhuma vaga de dev da Bahia no site aceita candidatura sem
 * assinatura. Radar que anuncia vaga que o usuario nao pode responder gasta a
 * atencao dele duas vezes. Quem quiser religar com recorte tem o sinal pronto
 * no HTML: `data-job-type="gratuita"` no botao do card (e a classe
 * `job__free__candidacy` na secao), contra `"exclusiva"` / `job__vip__candidacy`.
 *
 * O parser abaixo esta completo e testado contra HTML real, e volta a
 * funcionar sem nenhuma mudanca se a fonte passar a valer a pena.
 *
 * Duas requisicoes por vaga util: a listagem, que traz titulo, empresa, cidade
 * e modalidade, e o detalhe, que traz a descricao completa e — so ele — a data
 * de publicacao. O card NAO publica data em lugar nenhum: nem absoluta, nem
 * relativa, nem em atributo escondido. Como a janela de 72h depende dela, vaga
 * cujo detalhe nao informa `datePosted` fica fora.
 *
 * MEDIDO NA MESMA CAPTURA: a listagem nao e ordenada por data e acumula
 * anuncio antigo. Na primeira pagina de "desenvolvedor em Salvador/BA" o
 * anuncio mais novo era de 28/09, com um de 16/09/2025 ainda listado; nas
 * buscas home office os mais novos eram de 16/11. Ou seja, mesmo sem o
 * paywall a fonte renderia zero vaga dentro da janela na maioria dos ciclos —
 * por isso a cadencia de `BNE_INTERVAL_IN_HOURS`, e nao a de captura.
 *
 * LIMITACAO conhecida: o BNE normaliza o titulo para a funcao da busca, entao
 * quase todo anuncio se chama "Desenvolvedor". Como o fingerprint do radar e
 * `empresa + titulo`, dois anuncios diferentes da mesma empresa colapsam num
 * so. E perda da fonte, nao do parser.
 */
@Injectable()
export class BneScraperProvider extends BaseScraperProvider {
  readonly source = 'bne';
  readonly label = 'BNE';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Inject(SOURCE_LAST_RUN_READER) private readonly lastRun: ISourceLastRunReader,
    @Optional() private readonly searches: readonly BneSearch[] = BNE_DEFAULT_SEARCHES,
    @Optional() private readonly wait: (ms: number) => Promise<void> = sleep,
    @Optional() private readonly maxDetails: number = BNE_MAX_DETAILS_PER_CYCLE,
    @Optional() private readonly now: Clock = () => new Date(),
    @Optional() private readonly minIntervalHours: number = BNE_INTERVAL_IN_HOURS,
  ) {
    super();
  }

  /**
   * O intervalo e medido contra o banco, como no coletor de publicacoes: o
   * ciclo daqui custa dezenas de requisicoes e um restart da API nao pode
   * zerar a contagem.
   */
  override async isDue(reference: Date = this.now()): Promise<boolean> {
    const lastRunAt = await this.lastRun.getLastRunAt(this.source);

    if (lastRunAt === null) {
      return true;
    }

    const elapsedHours = (reference.getTime() - lastRunAt.getTime()) / MILLISECONDS_IN_HOUR;

    return elapsedHours >= this.minIntervalHours;
  }

  protected async collect(): Promise<RawJobProps[]> {
    // Segunda barreira: o orquestrador ja pergunta `isDue` antes de chamar,
    // mas uma chamada direta ao coletor nao passaria por la.
    if (!(await this.isDue())) {
      this.logger.debug('Dentro do intervalo minimo: busca no BNE adiada');

      return [];
    }

    const pace = createPacer(this.wait, BNE_REQUEST_DELAY_IN_MS);
    const candidates: BneCandidate[] = [];

    for (const search of this.searches) {
      candidates.push(...(await this.fetchSearch(search, pace)));
    }

    const unique = dedupeByUrl(candidates);
    const jobs: RawJobProps[] = [];

    // Teto estourado nao e erro, mas tambem nao pode passar em silencio: e o
    // sinal de que a listagem cresceu e que o ciclo esta deixando candidata
    // para tras — e nao ha como saber se a que ficou fora era a vaga nova.
    if (unique.length > this.maxDetails) {
      this.logger.warn(
        `${unique.length} candidatas e teto de ${this.maxDetails}: as demais ficam para o proximo ciclo`,
      );
    }

    for (const candidate of unique.slice(0, this.maxDetails)) {
      jobs.push(...(await this.fetchJob(candidate, pace)));
    }

    return jobs;
  }

  /** Uma funcao que o site aposentou responde 302 e nao leva as outras embora. */
  private async fetchSearch(search: BneSearch, pace: Pace): Promise<BneCandidate[]> {
    const url = bneSearchUrl(search);

    try {
      return this.parseCards(await this.request(url, pace));
    } catch (error: unknown) {
      this.logger.warn(`Busca ${url}: ${describeError(error)}`);

      return [];
    }
  }

  /** Detalhe que falha (anuncio retirado do ar, 429) so tira aquela vaga do ciclo. */
  private async fetchJob(candidate: BneCandidate, pace: Pace): Promise<RawJobProps[]> {
    try {
      return this.toRawJob(candidate, await this.request(candidate.url, pace));
    } catch (error: unknown) {
      this.logger.warn(`Detalhe de ${candidate.url}: ${describeError(error)}`);

      return [];
    }
  }

  private async request(url: string, pace: Pace): Promise<string> {
    await pace();

    const { body } = await this.http.get<string>(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'text/html' },
    });

    return body;
  }

  private parseCards(html: string): BneCandidate[] {
    const $ = cheerio.load(html);

    return $('div.card--list--vagas')
      .toArray()
      .flatMap((element) => toCandidate($, $(element)));
  }

  private toRawJob(candidate: BneCandidate, html: string): RawJobProps[] {
    const posting = jobPostingFrom(html);
    const reference = this.now();
    const publishedAt = parseDate(posting?.datePosted, reference);

    // Sem data nao ha como honrar a janela de 72h, e anuncio vencido ja saiu do
    // ar para quem se candidata: os dois ficam fora em vez de entrar como vaga
    // "capturada agora".
    if (!publishedAt || isExpired(posting?.validThrough, reference)) {
      return [];
    }

    const location = candidate.location || postingLocation(posting?.locality, posting?.region);

    return [
      {
        title: candidate.title,
        company: candidate.company || (posting?.company ?? ''),
        source: this.source,
        url: candidate.url,
        publishedAt,
        publishedAtSource: 'SOURCE',
        description: htmlToText(posting?.description ?? '') || candidate.summary,
        location,
        workModel: workModelFromText(`${candidate.workModelText} ${location} ${candidate.title}`),
      },
    ];
  }
}

export function bneSearchUrl(search: BneSearch): string {
  const path = search.city ? `${search.role}-em-${search.city}` : search.role;
  const query = search.homeOffice ? '?HomeOffice=True' : '';

  return `${BNE_ORIGIN}/vagas-de-emprego-para-${path}${query}`;
}

/** "Salvador / BA" na listagem; no JSON-LD a cidade e a UF vem separadas. */
function postingLocation(locality: string | undefined, region: string | undefined): string {
  return [locality ?? '', region ?? ''].filter((part) => part.length > 0).join(' / ');
}

function isExpired(validThrough: string | undefined, reference: Date): boolean {
  const limit = parseDate(validThrough, reference);

  return limit !== undefined && limit.getTime() < reference.getTime();
}

function toCandidate(nodes: cheerio.CheerioAPI, card: HtmlNodes): BneCandidate[] {
  const link = card.find('a.card__link').first();
  const url = toAbsoluteUrl(BNE_ORIGIN, link.attr('href') ?? '');
  const title = readTitle(link);

  // O recorte de cargo e o que segura o numero de detalhes: a funcao do site e
  // larga e traz desde "Teste Vaga De Publicacao" ate cargo de outra area.
  if (!url || title.length === 0 || !looksLikeDeveloperRole(title)) {
    return [];
  }

  return [{ url, title, summary: readSummary(card), ...readInfo(nodes, card) }];
}

/**
 * O titulo mora no atributo `title` do link, unico lugar com o texto que a
 * empresa escreveu — o texto do link vem prefixado ("Vaga De ...", "2 Vagas De
 * ...") e o `h1` do detalhe repete o mesmo prefixo.
 *
 * O atributo termina em " em Cidade/UF", acrescentado pelo site para busca; o
 * recorte sai dai e nao de qualquer " em ", para nao mutilar um titulo que
 * legitimamente diga "Desenvolvedor em Formacao".
 */
function readTitle(link: HtmlNodes): string {
  const fromAttribute = collapseSpaces(link.attr('title') ?? '').replace(CITY_SUFFIX, '');

  if (fromAttribute.length > 0) {
    return fromAttribute;
  }

  return collapseSpaces(link.text()).replace(VACANCY_PREFIX, '');
}

/**
 * Os quatro itens do card: funcao, empresa, modalidade e cidade.
 *
 * A leitura e por conteudo e nao por posicao: um card sem empresa informada
 * tem tres itens, e a modalidade subiria para a posicao da empresa. O primeiro
 * item fica fora de proposito — e a funcao da busca, nao o titulo da vaga.
 */
function readInfo(
  nodes: cheerio.CheerioAPI,
  card: HtmlNodes,
): Pick<BneCandidate, 'company' | 'location' | 'workModelText'> {
  // Cada item comeca com um icone; um `<title>` dentro do SVG — que o site
  // pode acrescentar por acessibilidade a qualquer momento — entraria no texto
  // e empurraria a leitura por conteudo para o item errado.
  card.find('.info__vaga-item svg').remove();

  const [, ...items] = card
    .find('.info__vaga-item')
    .toArray()
    .map((element) => collapseSpaces(nodes(element).text()));
  const location = items.find((item) => CITY_AND_STATE.test(item)) ?? '';
  const workModelText = items.find((item) => WORK_MODEL_LABEL.test(item)) ?? '';
  const company = items.find((item) => item !== location && item !== workModelText) ?? '';

  return { company, location, workModelText };
}

/** O resumo do card e a descricao cortada, com o "..." num span proprio. */
function readSummary(card: HtmlNodes): string {
  const summary = card.find('p.job__description-text').first().clone();

  summary.find('.job__description-ellipsis').remove();

  return collapseSpaces(summary.text());
}

const CITY_SUFFIX = /\s+em\s+[^/]+\/\s*[A-Za-z]{2}\s*$/;
const VACANCY_PREFIX = /^\d*\s*vagas?\s+de\s+/i;
const CITY_AND_STATE = /\/\s*[A-Za-z]{2}$/;
const WORK_MODEL_LABEL = /^(home\s*office|presencial|h[ií]brido)$/i;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
