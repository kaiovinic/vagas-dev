import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { JobWorkModel } from '@/domain/entities/job';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  dedupeByUrl,
  parseDate,
} from '@/infra/scrapers/support/scraper-helpers';

const COODESH_ORIGIN = 'https://coodesh.com';
const SITEMAP_URL = `${COODESH_ORIGIN}/sitemaps/jobs.xml`;
const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;

/**
 * Janela do `lastmod`, mais larga que as 72h das regras de propósito: o
 * `lastmod` diz quando a PAGINA mudou, nao quando a vaga foi publicada.
 * Cortar em 72h aqui perderia vaga nova cuja pagina nao e tocada desde ontem.
 * Quem aplica a janela real e o `JobRuleEngine`, sobre o `datePosted`.
 */
export const COODESH_SITEMAP_WINDOW_IN_DAYS = 5;

/** Teto de requisicoes por captura: uma pagina por vaga sai caro. */
export const COODESH_MAX_JOB_PAGES = 30;

const SITEMAP_ENTRY = /<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
const LD_JSON_BLOCK = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

type Clock = () => Date;

interface JsonLdAddress {
  readonly addressLocality?: unknown;
  readonly addressRegion?: unknown;
}

interface JsonLdJobPosting {
  readonly '@type'?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly datePosted?: unknown;
  readonly jobLocationType?: unknown;
  readonly hiringOrganization?: { readonly name?: unknown } | null;
  readonly jobLocation?: { readonly address?: JsonLdAddress | null } | null;
}

/**
 * Coletor da Coodesh.
 *
 * A listagem do site e renderizada no cliente e a api (`api.coodesh.com`) exige
 * autenticacao, entao o caminho publico e outro: o sitemap de vagas, que o
 * proprio `robots.txt` anuncia, da a lista de URLs, e cada pagina de vaga traz
 * um bloco `JobPosting` em JSON-LD com titulo, empresa, data e endereco.
 *
 * Ler dado estruturado que o site publica para buscadores e mais estavel do que
 * raspar marcacao, que muda a cada deploy.
 */
@Injectable()
export class CoodeshScraperProvider extends BaseScraperProvider {
  readonly source = 'coodesh';
  readonly label = 'Coodesh';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly now: Clock = () => new Date(),
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const urls = await this.discoverRecentJobUrls();
    const pages = await Promise.all(urls.map((url) => this.fetchJob(url)));

    return dedupeByUrl(pages.flat());
  }

  private async discoverRecentJobUrls(): Promise<string[]> {
    const { body } = await this.http.get<string>(SITEMAP_URL, { headers: { Accept: 'text/xml' } });
    const limit = this.now().getTime() - COODESH_SITEMAP_WINDOW_IN_DAYS * MILLISECONDS_IN_DAY;
    const recent: { readonly url: string; readonly modified: number }[] = [];

    for (const [, url, lastModified] of String(body).matchAll(SITEMAP_ENTRY)) {
      const modified = Date.parse(String(lastModified));

      if (url && Number.isFinite(modified) && modified >= limit) {
        recent.push({ url, modified });
      }
    }

    return recent
      .sort((left, right) => right.modified - left.modified)
      .slice(0, COODESH_MAX_JOB_PAGES)
      .map((entry) => entry.url);
  }

  /** Uma pagina fora do ar nao pode levar as outras junto. */
  private async fetchJob(url: string): Promise<RawJobProps[]> {
    try {
      const { body } = await this.http.get<string>(url, { headers: { Accept: 'text/html' } });
      const posting = findJobPosting(String(body));

      return posting ? this.toRawJob(posting, url) : [];
    } catch (error: unknown) {
      this.logger.debug(`Vaga ignorada (${url}): ${describe(error)}`);

      return [];
    }
  }

  private toRawJob(posting: JsonLdJobPosting, url: string): RawJobProps[] {
    const title = collapseSpaces(readString(posting.title));
    const company = collapseSpaces(readString(posting.hiringOrganization?.name));
    const publishedAt = parseDate(posting.datePosted, this.now());

    if (title.length === 0 || company.length === 0 || !publishedAt) {
      return [];
    }

    const location = readPlace(posting);

    return [
      {
        title,
        company,
        source: this.source,
        url,
        publishedAt,
        publishedAtSource: 'SOURCE',
        description: stripHtml(readString(posting.description)),
        location,
        workModel: readWorkModel(posting, location),
      },
    ];
  }
}

function findJobPosting(html: string): JsonLdJobPosting | undefined {
  for (const [, block] of html.matchAll(LD_JSON_BLOCK)) {
    const parsed = parseJson(block ?? '');
    const nodes = Array.isArray((parsed as { '@graph'?: unknown })?.['@graph'])
      ? ((parsed as { '@graph': unknown[] })['@graph'] as JsonLdJobPosting[])
      : [parsed as JsonLdJobPosting];

    const posting = nodes.find((node) => node?.['@type'] === 'JobPosting');

    if (posting) {
      return posting;
    }
  }

  return undefined;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** "Bogotá - Bogota"; vaga remota costuma vir sem endereco. */
function readPlace(posting: JsonLdJobPosting): string {
  const address = posting.jobLocation?.address;
  const city = collapseSpaces(readString(address?.addressLocality));
  const region = collapseSpaces(readString(address?.addressRegion));

  return [city, region].filter((part) => part.length > 0).join(' - ');
}

function readWorkModel(posting: JsonLdJobPosting, location: string): JobWorkModel {
  if (readString(posting.jobLocationType).toUpperCase() === 'TELECOMMUTE') {
    return 'REMOTE';
  }

  return location.length > 0 ? 'ONSITE' : 'UNKNOWN';
}

function stripHtml(value: string): string {
  return collapseSpaces(value.replace(/<[^>]*>/g, ' '));
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
