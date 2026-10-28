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

const PORTAL_SEARCH_URL = 'https://portal.gupy.io/job-search/term=';
const NEXT_DATA_PATTERN = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const GUPY_HOST_SUFFIX = '.gupy.io';

export const GUPY_DEFAULT_TERMS: readonly string[] = [
  'frontend',
  'front-end',
  'fullstack',
  'react',
  'node',
  'angular',
];

interface GupyPortalJob {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly careerPageName?: unknown;
  readonly publishedDate?: unknown;
  readonly workplaceType?: unknown;
  readonly city?: unknown;
  readonly state?: unknown;
  readonly jobUrl?: unknown;
}

/**
 * Coletor da Gupy. O portal publico e renderizado no servidor e embute o resultado
 * da busca em `__NEXT_DATA__` (`props.pageProps.initialJobList.data`), que e o JSON
 * consumido aqui — a Gupy nao expoe uma API REST publica para o portal.
 */
@Injectable()
export class GupyScraperProvider extends BaseScraperProvider {
  readonly source = 'gupy';
  readonly label = 'Gupy';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly terms: readonly string[] = GUPY_DEFAULT_TERMS,
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pages = await Promise.all(this.terms.map((term) => this.fetchTerm(term)));

    return dedupeByUrl(pages.flat());
  }

  private async fetchTerm(term: string): Promise<RawJobProps[]> {
    const url = `${PORTAL_SEARCH_URL}${encodeURIComponent(term)}`;
    const { body } = await this.http.get<string>(url, {
      headers: { Accept: 'text/html' },
    });

    return extractJobs(body).flatMap((job) => this.toRawJob(job));
  }

  private toRawJob(job: GupyPortalJob): RawJobProps[] {
    const title = readString(job.name);
    const url = readString(job.jobUrl);
    const publishedAt = parseDate(job.publishedDate);
    const company = resolveCompany(url, readString(job.careerPageName));

    if (title.length === 0 || url.length === 0 || company.length === 0 || !publishedAt) {
      return [];
    }

    const workModel = toWorkModel(readString(job.workplaceType));

    return [
      {
        title,
        company,
        source: this.source,
        url,
        publishedAt,
        publishedAtSource: 'SOURCE',
        description: readString(job.description),
        location: resolveLocation(readString(job.city), readString(job.state), workModel),
        workModel,
      },
    ];
  }
}

function extractJobs(html: string): GupyPortalJob[] {
  const match = NEXT_DATA_PATTERN.exec(html);

  if (!match?.[1]) {
    return [];
  }

  const payload: unknown = JSON.parse(match[1]);
  const data = readPath(payload, ['props', 'pageProps', 'initialJobList', 'data']);

  return Array.isArray(data) ? (data as GupyPortalJob[]) : [];
}

function readPath(source: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, source);
}

/**
 * `careerPageName` costuma trazer slogan de employer branding ("VENHA SER #SANGUELARANJA"),
 * enquanto o subdominio do `jobUrl` e o tenant da empresa — base muito mais estavel
 * para o fingerprint de deduplicacao.
 */
function resolveCompany(jobUrl: string, careerPageName: string): string {
  const tenant = readTenant(jobUrl);

  if (tenant) {
    return tenant;
  }

  return collapseSpaces(careerPageName);
}

function readTenant(jobUrl: string): string | undefined {
  try {
    const { hostname } = new URL(jobUrl);

    if (!hostname.endsWith(GUPY_HOST_SUFFIX)) {
      return undefined;
    }

    const tenant = hostname.slice(0, -GUPY_HOST_SUFFIX.length);

    return tenant.length === 0 ? undefined : toTitleCase(tenant);
  } catch {
    return undefined;
  }
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toWorkModel(workplaceType: string): JobWorkModel {
  const normalized = workplaceType.toLowerCase();

  if (normalized === 'remote') {
    return 'REMOTE';
  }

  if (normalized === 'hybrid') {
    return 'HYBRID';
  }

  if (normalized === 'on-site' || normalized === 'on_site' || normalized === 'onsite') {
    return 'ONSITE';
  }

  return 'UNKNOWN';
}

function resolveLocation(city: string, state: string, workModel: JobWorkModel): string {
  const parts = [city, state].map(collapseSpaces).filter((part) => part.length > 0);

  if (parts.length > 0) {
    return parts.join(' - ');
  }

  return workModel === 'REMOTE' ? 'Remoto' : '';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
