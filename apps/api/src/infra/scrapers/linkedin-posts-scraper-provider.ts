import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  authorDisplayName,
  parsePostUrl,
  type LinkedinPostRef,
} from '@/infra/scrapers/support/linkedin-post';
import { collapseSpaces, dedupeByUrl } from '@/infra/scrapers/support/scraper-helpers';

/**
 * Operador de busca para achar publicacoes que anunciam vaga. O `site:` limita
 * ao caminho de publicacoes — perfil, artigo e pagina de empresa ficam de fora.
 */
export const LINKEDIN_POSTS_QUERY =
  'site:linkedin.com/posts ("vaga" OR "contratando" OR "estamos buscando" OR "candidate-se") ' +
  '("react" OR "frontend" OR "front-end" OR "fullstack" OR "desenvolvedor" OR "node" OR ".net")';

/** Recorte de recencia: `qdr:d3` = ultimos 3 dias, a janela do radar. */
export const LINKEDIN_POSTS_RECENCY = 'qdr:d3';

/**
 * Resultados por consulta. Dez e o teto da conta gratuita do Serper: pedir
 * `num` acima disso devolve 400 com "Query pattern not allowed for free
 * accounts", e o mesmo vale para omitir e deixar o padrao subir.
 */
export const LINKEDIN_POSTS_RESULT_LIMIT = 10;

/** Paginas por captura. Sao 10 por pagina, e as paginas nao se repetem. */
export const LINKEDIN_POSTS_PAGES = 3;

export const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export interface SerpConfig {
  /** Endpoint do buscador; o padrao e o Serper. */
  readonly endpoint: string;
  /** Vazia desliga o coletor. */
  readonly apiKey: string;
}

interface SerpResult {
  readonly title?: unknown;
  readonly link?: unknown;
  readonly url?: unknown;
  readonly snippet?: unknown;
  readonly description?: unknown;
}

/**
 * Coletor de publicacoes do LinkedIn, pelo indice de um buscador.
 *
 * Por que um buscador: o LinkedIn nao expoe busca de posts por palavra-chave
 * sem autenticacao, e raspar logado viola o acordo de uso e poe a conta em
 * risco. O indice publico do Google ja tem esses posts, e consulta-lo e so
 * leitura de resultado de busca.
 *
 * Fala com o Serper, que indexa o Google. A chamada e POST com a consulta no
 * corpo — e a unica do projeto que nao e GET, e foi por ela que a porta
 * `IHttpClient` ganhou `post`.
 *
 * Sem `SERP_API_KEY` o coletor e um no-op silencioso: um ambiente sem chave
 * nao pode quebrar a captura das outras fontes.
 *
 * A data NAO vem do buscador: ela sai do snowflake embutido na URL do post,
 * com precisao de minutos. E o que torna a janela de 72h confiavel aqui.
 */
@Injectable()
export class LinkedinPostsScraperProvider extends BaseScraperProvider {
  readonly source = 'linkedin-posts';
  readonly label = 'Publicacoes do LinkedIn';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly config: SerpConfig = readConfigFromEnv(),
    @Optional() private readonly pages: number = LINKEDIN_POSTS_PAGES,
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    if (!this.isConfigured()) {
      this.logger.debug('Busca nao configurada: coletor de publicacoes ignorado');

      return [];
    }

    const pages = await Promise.all(
      Array.from({ length: this.pages }, (_unused, index) => this.fetchPage(index + 1)),
    );

    return dedupeByUrl(pages.flat());
  }

  /** O Serper so aceita POST, com a consulta no corpo. */
  private async fetchPage(page: number): Promise<RawJobProps[]> {
    const { body } = await this.http.post<unknown>(
      this.config.endpoint,
      {
        q: LINKEDIN_POSTS_QUERY,
        tbs: LINKEDIN_POSTS_RECENCY,
        num: LINKEDIN_POSTS_RESULT_LIMIT,
        gl: 'br',
        hl: 'pt-br',
        page,
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-KEY': this.config.apiKey,
        },
      },
    );

    return readResults(body).flatMap((result) => this.toRawJob(result));
  }

  private toRawJob(result: SerpResult): RawJobProps[] {
    const post = parsePostUrl(readString(result.link) || readString(result.url));

    if (!post) {
      return [];
    }

    const snippet = collapseSpaces(readString(result.snippet) || readString(result.description));
    const title = buildTitle(result, snippet);

    if (title.length === 0) {
      return [];
    }

    return [
      {
        title,
        // Quem publica o post e a pessoa, nao a empresa: o nome dela e o unico
        // identificador confiavel, e e o que alimenta a deduplicacao.
        company: authorDisplayName(post.author),
        source: this.source,
        url: post.url,
        publishedAt: post.publishedAt,
        publishedAtSource: 'SOURCE',
        // Declara a origem: o motor exige marcador de anuncio em post social.
        origin: 'SOCIAL_POST',
        description: snippet,
        location: '',
        workModel: 'UNKNOWN',
        recruiterName: authorDisplayName(post.author),
      },
    ];
  }

  private isConfigured(): boolean {
    return this.config.endpoint.length > 0 && this.config.apiKey.length > 0;
  }

  /** So para o comando de diagnostico: a consulta exata que vai ao buscador. */
  get query(): string {
    return LINKEDIN_POSTS_QUERY;
  }
}

/**
 * O buscador formata o titulo como `<Autor> on LinkedIn: <texto> | LinkedIn`.
 * O que interessa e o meio: o comeco repete o autor, que ja sai da URL, e o
 * fim e o nome do site.
 */
const TITLE_PREFIX = /^.*?\bon LinkedIn:\s*/i;
const TITLE_SUFFIX = /\s*\|\s*LinkedIn\s*$/i;

const TITLE_MAX_LENGTH = 140;

function buildTitle(result: SerpResult, snippet: string): string {
  // O snippet vem primeiro porque ele E o anuncio. O campo `title` do
  // buscador so traz metadado — "Publicacao de Fulano" em portugues,
  // "Fulano on LinkedIn: ..." em ingles — e nao diz nada sobre a vaga.
  if (snippet.length > 0) {
    return truncate(snippet, TITLE_MAX_LENGTH);
  }

  const headline = collapseSpaces(readString(result.title))
    .replace(TITLE_SUFFIX, '')
    .replace(TITLE_PREFIX, '')
    .trim();

  return truncate(headline, TITLE_MAX_LENGTH);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Formatos aceitos: `organic_results` (SerpApi) e `organic` (Serper). Um
 * fornecedor novo entra como mais uma chave nesta lista.
 */
function readResults(body: unknown): SerpResult[] {
  const payload = body as Record<string, unknown> | null;

  for (const key of ['organic_results', 'organic', 'results']) {
    const candidate = payload?.[key];

    if (Array.isArray(candidate)) {
      return candidate as SerpResult[];
    }
  }

  return [];
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readConfigFromEnv(): SerpConfig {
  return {
    // O endpoint do Serper e fixo; a variavel existe so para apontar para
    // outro fornecedor sem mexer no codigo.
    endpoint: process.env.SERP_ENDPOINT ?? SERPER_ENDPOINT,
    apiKey: process.env.SERP_API_KEY ?? '',
  };
}

export type { LinkedinPostRef };
