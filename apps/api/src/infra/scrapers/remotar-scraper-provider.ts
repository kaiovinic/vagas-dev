import { Inject, Injectable, Optional } from '@nestjs/common';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import type { JobWorkModel } from '@/domain/entities/job';
import { HTTP_CLIENT, type IHttpClient } from '@/domain/providers/http-client';
import { BaseScraperProvider } from '@/infra/scrapers/support/base-scraper-provider';
import {
  collapseSpaces,
  dedupeByUrl,
  parseDate,
  uniqueStrings,
} from '@/infra/scrapers/support/scraper-helpers';

const REMOTAR_API_URL = 'https://api.remotar.com.br/jobs';
const REMOTAR_JOB_URL = 'https://remotar.com.br/vaga';
const DEFAULT_PAGES = 2;

interface RemotarTag {
  readonly tag?: { readonly name?: unknown } | null;
}

interface RemotarJob {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly subtitle?: unknown;
  readonly description?: unknown;
  readonly city?: unknown;
  readonly state?: unknown;
  readonly type?: unknown;
  readonly expired?: unknown;
  readonly active?: unknown;
  readonly externalLink?: unknown;
  readonly isExternalLink?: unknown;
  readonly createdAt?: unknown;
  readonly company?: { readonly name?: unknown } | null;
  readonly companyDisplayName?: unknown;
  readonly author?: { readonly name?: unknown } | null;
  readonly jobTags?: readonly RemotarTag[];
}

/**
 * Coletor do Remotar, que expoe uma API JSON publica e paginada
 * (`api.remotar.com.br/jobs`) com `meta.last_page`.
 */
@Injectable()
export class RemotarScraperProvider extends BaseScraperProvider {
  readonly source = 'remotar';
  readonly label = 'Remotar';

  constructor(
    @Inject(HTTP_CLIENT) private readonly http: IHttpClient,
    @Optional() private readonly pages: number = DEFAULT_PAGES,
  ) {
    super();
  }

  protected async collect(): Promise<RawJobProps[]> {
    const pageNumbers = Array.from({ length: this.pages }, (_unused, index) => index + 1);
    const pages = await Promise.all(pageNumbers.map((page) => this.fetchPage(page)));

    return dedupeByUrl(pages.flat());
  }

  private async fetchPage(page: number): Promise<RawJobProps[]> {
    const { body } = await this.http.get<unknown>(`${REMOTAR_API_URL}?page=${page}`, {
      headers: { Accept: 'application/json' },
    });

    return readJobs(body).flatMap((job) => this.toRawJob(job));
  }

  private toRawJob(job: RemotarJob): RawJobProps[] {
    if (job.expired === true || job.active === false) {
      return [];
    }

    const title = readString(job.title);
    const company = resolveCompany(job);
    const url = resolveUrl(job);
    const publishedAt = parseDate(job.createdAt);

    if (title.length === 0 || company.length === 0 || !url || !publishedAt) {
      return [];
    }

    return [
      {
        title,
        company,
        source: this.source,
        url,
        publishedAt,
        publishedAtSource: 'SOURCE',
        description: collapseSpaces(`${readString(job.subtitle)} ${readString(job.description)}`),
        location: resolveLocation(job),
        workModel: toWorkModel(readString(job.type)),
        recruiterName: readString(job.author?.name),
        tags: readTags(job.jobTags),
      },
    ];
  }
}

function readJobs(body: unknown): RemotarJob[] {
  if (body === null || typeof body !== 'object') {
    return [];
  }

  const { data } = body as { data?: unknown };

  return Array.isArray(data) ? (data as RemotarJob[]) : [];
}

function resolveCompany(job: RemotarJob): string {
  const candidates = [readString(job.company?.name), readString(job.companyDisplayName)];

  return candidates.find((candidate) => candidate.length > 0) ?? '';
}

/** Vagas intermediadas apontam para o ATS do cliente; as proprias ficam no Remotar. */
function resolveUrl(job: RemotarJob): string | undefined {
  const externalLink = readString(job.externalLink);

  if (job.isExternalLink === true && externalLink.length > 0) {
    return externalLink;
  }

  const id = readIdentifier(job.id);

  return id ? `${REMOTAR_JOB_URL}/${id}` : undefined;
}

function readIdentifier(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveLocation(job: RemotarJob): string {
  const parts = [readString(job.city), readString(job.state)].filter((part) => part.length > 0);

  if (parts.length > 0) {
    return parts.join(' - ');
  }

  return toWorkModel(readString(job.type)) === 'REMOTE' ? 'Remoto' : '';
}

function toWorkModel(type: string): JobWorkModel {
  const normalized = type.toLowerCase();

  if (normalized === 'remote') {
    return 'REMOTE';
  }

  if (normalized === 'hybrid') {
    return 'HYBRID';
  }

  if (normalized === 'presential' || normalized === 'onsite') {
    return 'ONSITE';
  }

  return 'UNKNOWN';
}

function readTags(jobTags: readonly RemotarTag[] | undefined): string[] {
  return uniqueStrings((jobTags ?? []).map((entry) => readString(entry.tag?.name)));
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
