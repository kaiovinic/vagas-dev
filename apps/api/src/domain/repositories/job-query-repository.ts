import type { JobWorkModel } from '@/domain/entities/job';
import type { PublishedAtSource } from '@/domain/dtos/raw-job-props';
import type { JobScope } from '@/domain/services/job-scope';

export const JOB_QUERY_REPOSITORY = Symbol.for('JOB_QUERY_REPOSITORY');

export const JOB_SORT_FIELDS = ['publishedAt', 'company', 'title'] as const;

export type JobSortField = (typeof JOB_SORT_FIELDS)[number];

export type SortDirection = 'asc' | 'desc';

/**
 * Os campos opcionais aceitam `undefined` explicito (e nao apenas a ausencia da
 * chave) porque o `tsconfig` roda com `exactOptionalPropertyTypes` e os filtros
 * chegam da query string ja como `undefined` quando nao informados.
 */
export interface JobListFilters {
  /** Busca textual em titulo, empresa e descricao. */
  readonly search?: string | undefined;
  /** Tecnologias da stack; a vaga precisa citar ao menos uma delas. */
  readonly technologies?: readonly string[] | undefined;
  /**
   * Termos de senioridade ja expandidos pelo dominio (`expandSeniorities`);
   * a vaga precisa citar ao menos um deles.
   */
  readonly seniorityKeywords?: readonly string[] | undefined;
  readonly source?: string | undefined;
  /** Mercado da vaga: nacional ou internacional. */
  readonly scope?: JobScope | undefined;
  readonly company?: string | undefined;
  readonly recruiterName?: string | undefined;
  readonly isRemote?: boolean | undefined;
  readonly city?: string | undefined;
  /** Limite inferior de publicacao; o padrao da aba `Vagas` sao as ultimas 72h. */
  readonly publishedAfter?: Date | undefined;
  readonly page: number;
  readonly perPage: number;
  readonly sortBy: JobSortField;
  readonly sortDirection: SortDirection;
}

export interface JobListItem {
  readonly id: string;
  readonly fingerprint: string;
  readonly title: string;
  readonly company: string;
  readonly recruiterName: string | null;
  readonly source: string;
  readonly city: string | null;
  readonly isRemote: boolean;
  readonly scope: JobScope;
  readonly workModel: JobWorkModel;
  readonly url: string;
  readonly tags: readonly string[];
  readonly publishedAt: Date;
  readonly publishedAtSource: PublishedAtSource;
}

export interface PaginatedJobs {
  readonly items: readonly JobListItem[];
  readonly total: number;
  readonly page: number;
  readonly perPage: number;
}

/** Agregado das abas `Empresas` e `Recrutadores`. */
export interface HiringEntityCount {
  readonly name: string;
  readonly total: number;
  readonly remoteTotal: number;
  readonly lastPublishedAt: Date;
}

/**
 * Contrato de leitura da listagem (ISP): separado das metricas do dashboard e
 * de qualquer escrita de captura.
 */
export interface IJobQueryRepository {
  list(filters: JobListFilters): Promise<PaginatedJobs>;
  countByCompany(publishedAfter: Date): Promise<HiringEntityCount[]>;
  countByRecruiter(publishedAfter: Date): Promise<HiringEntityCount[]>;
}
