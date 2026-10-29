import { Inject, Injectable } from '@nestjs/common';

import {
  JOB_QUERY_REPOSITORY,
  type HiringEntityCount,
  type IJobQueryRepository,
  type JobListItem,
  type JobSortField,
  type SortDirection,
} from '@/domain/repositories/job-query-repository';
import { PUBLICATION_WINDOW_IN_HOURS } from '@/domain/services/job-rule-engine';
import { expandSeniorities } from '@/domain/services/job-seniority';
import type { JobScope } from '@/domain/services/job-scope';

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;

export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 100;

export interface ListJobsInput {
  readonly search?: string | undefined;
  readonly technologies?: readonly string[] | undefined;
  /** Niveis de senioridade (`INTERN`, `JUNIOR`, `MID`, `SENIOR`). */
  readonly seniorities?: readonly string[] | undefined;
  readonly source?: string | undefined;
  readonly scope?: JobScope | undefined;
  readonly company?: string | undefined;
  readonly recruiterName?: string | undefined;
  readonly isRemote?: boolean | undefined;
  readonly city?: string | undefined;
  readonly page?: number | undefined;
  readonly perPage?: number | undefined;
  readonly sortBy?: JobSortField | undefined;
  readonly sortDirection?: SortDirection | undefined;
  /** Por padrao a listagem respeita a janela de 72h, como as abas do dashboard. */
  readonly includeExpired?: boolean | undefined;
  /**
   * Recorte temporal da aba `Vagas` (1h, 6h, 24h...). Nunca amplia a janela
   * publica de 72h: o maximo e o proprio limite do radar.
   */
  readonly withinHours?: number | undefined;
}

export interface ListJobsOutput {
  readonly items: readonly JobListItem[];
  readonly total: number;
  readonly page: number;
  readonly perPage: number;
  readonly totalPages: number;
}

/** Listagem paginada e filtravel que alimenta as abas Vagas, Empresas e Recrutadores. */
@Injectable()
export class ListJobsUseCase {
  constructor(
    @Inject(JOB_QUERY_REPOSITORY) private readonly jobs: IJobQueryRepository,
  ) {}

  async execute(input: ListJobsInput = {}, reference: Date = new Date()): Promise<ListJobsOutput> {
    const page = normalizePositive(input.page, 1);
    const perPage = Math.min(normalizePositive(input.perPage, DEFAULT_PER_PAGE), MAX_PER_PAGE);

    const result = await this.jobs.list({
      search: input.search,
      technologies: normalizeTechnologies(input.technologies),
      seniorityKeywords: normalizeSeniorities(input.seniorities),
      source: input.source,
      scope: input.scope,
      company: input.company,
      recruiterName: input.recruiterName,
      isRemote: input.isRemote,
      city: input.city,
      publishedAfter:
        input.includeExpired === true ? undefined : windowStart(input.withinHours, reference),
      page,
      perPage,
      sortBy: input.sortBy ?? 'publishedAt',
      sortDirection: input.sortDirection ?? 'desc',
    });

    return {
      items: result.items,
      total: result.total,
      page: result.page,
      perPage: result.perPage,
      totalPages: Math.ceil(result.total / result.perPage),
    };
  }

  /** Aba `Empresas`: empresas contratando nas ultimas 72h. */
  async listCompanies(reference: Date = new Date()): Promise<HiringEntityCount[]> {
    return this.jobs.countByCompany(openWindowStart(reference));
  }

  /** Aba `Recrutadores`: quem publicou vagas nas ultimas 72h. */
  async listRecruiters(reference: Date = new Date()): Promise<HiringEntityCount[]> {
    return this.jobs.countByRecruiter(openWindowStart(reference));
  }
}

/** Traduz os niveis escolhidos nos termos que o repositorio procura no texto. */
function normalizeSeniorities(
  seniorities: readonly string[] | undefined,
): readonly string[] | undefined {
  const keywords = expandSeniorities(seniorities ?? []);

  return keywords.length > 0 ? keywords : undefined;
}

/** Lista vazia e o mesmo que "sem filtro de stack". */
function normalizeTechnologies(
  technologies: readonly string[] | undefined,
): readonly string[] | undefined {
  const cleaned = (technologies ?? [])
    .map((technology) => technology.trim())
    .filter((technology) => technology.length > 0);

  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Inicio da janela consultada. Sem `withinHours`, usa as 72h do radar; com,
 * usa o menor dos dois — pedir 200h nao pode revelar vaga ja expirada.
 */
function windowStart(withinHours: number | undefined, reference: Date): Date {
  const hours = Math.min(withinHours ?? PUBLICATION_WINDOW_IN_HOURS, PUBLICATION_WINDOW_IN_HOURS);

  return new Date(reference.getTime() - hours * 60 * 60 * 1000);
}

function openWindowStart(reference: Date): Date {
  return new Date(reference.getTime() - PUBLICATION_WINDOW_IN_HOURS * MILLISECONDS_IN_HOUR);
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.trunc(value);
}
