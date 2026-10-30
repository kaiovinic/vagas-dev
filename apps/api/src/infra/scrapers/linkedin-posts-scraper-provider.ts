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

/** Recorte de recencia pedido ao buscador: `qdr:d` = ultimas 24h no Google. */
export const LINKEDIN_POSTS_RECENCY = 'qdr:d';

export const LINKEDIN_POSTS_RESULT_LIMIT = 50;

export interface SerpConfig {
  /** Endpoint do buscador; vazio desliga o coletor. */
  readonly endpoint: string;
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
 * ATENCAO — a fonte NAO foi exercitada contra um buscador real. Todas as APIs
 * de SERP com indice do Google exigem cadastro com cartao, que nao foi feito.
 * O parser aceita os dois formatos documentados que cabem na porta `GET`
 * (`organic_results` do SerpApi e `organic` do Serper) e esta coberto por
 * testes, mas o acerto do formato so se confirma com uma chave de verdade.
 * Sem `SERP_ENDPOINT` e `SERP_API_KEY` o coletor e um no-op silencioso.
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
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    if (!this.isConfigured()) {
      this.logger.debug('Busca nao configurada: coletor de publicacoes ignorado');

      return [];
    }

    const { body } = await this.http.get<unknown>(this.buildUrl(), {
      headers: { Accept: 'application/json', 'X-API-KEY': this.config.apiKey },
    });

    return dedupeByUrl(readResults(body).flatMap((result) => this.toRawJob(result)));
  }

  private buildUrl(): string {
    const params = new URLSearchParams({
      q: LINKEDIN_POSTS_QUERY,
      tbs: LINKEDIN_POSTS_RECENCY,
      num: String(LINKEDIN_POSTS_RESULT_LIMIT),
      gl: 'br',
      hl: 'pt-br',
      // O SerpApi le a chave da query; o Serper, do cabecalho. Mandar nos dois
      // evita um adaptador por fornecedor.
      api_key: this.config.apiKey,
    });

    return `${this.config.endpoint}?${params.toString()}`;
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
}

/**
 * O buscador formata o titulo como `<Autor> on LinkedIn: <texto> | LinkedIn`.
 * O que interessa e o meio: o comeco repete o autor, que ja sai da URL, e o
 * fim e o nome do site.
 */
const TITLE_PREFIX = /^.*?\bon LinkedIn:\s*/i;
const TITLE_SUFFIX = /\s*\|\s*LinkedIn\s*$/i;

function buildTitle(result: SerpResult, snippet: string): string {
  const headline = collapseSpaces(readString(result.title))
    .replace(TITLE_SUFFIX, '')
    .replace(TITLE_PREFIX, '')
    .trim();

  return headline.length > 0 ? headline : snippet.slice(0, 140);
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
    endpoint: process.env.SERP_ENDPOINT ?? '',
    apiKey: process.env.SERP_API_KEY ?? '',
  };
}

export type { LinkedinPostRef };
