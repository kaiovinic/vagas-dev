import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { buildPath, fetchJson } from '@/api/http';
import { jobsListSchema, type JobsList } from '@/api/schemas';

export const JOBS_STALE_TIME_MS = 60_000;

export type JobSortField = 'publishedAt' | 'company' | 'title';
export type SortDirection = 'asc' | 'desc';

export interface JobsListFilters {
  readonly search?: string | undefined;
  readonly technologies?: readonly string[] | undefined;
  readonly seniorities?: readonly string[] | undefined;
  readonly source?: string | undefined;
  readonly company?: string | undefined;
  readonly recruiterName?: string | undefined;
  readonly city?: string | undefined;
  readonly isRemote?: boolean | undefined;
  readonly includeExpired?: boolean | undefined;
  readonly page?: number | undefined;
  readonly perPage?: number | undefined;
  readonly sortBy?: JobSortField | undefined;
  readonly sortDirection?: SortDirection | undefined;
}

export function jobsListQueryKey(filters: JobsListFilters): readonly unknown[] {
  return ['jobs', 'list', filters] as const;
}

export function useJobsList(filters: JobsListFilters = {}): UseQueryResult<JobsList, Error> {
  return useQuery({
    queryKey: jobsListQueryKey(filters),
    queryFn: ({ signal }) =>
      fetchJson(buildPath('/api/jobs', toQueryParams(filters)), jobsListSchema, signal),
    staleTime: JOBS_STALE_TIME_MS,
    // Paginar e filtrar sem derrubar a tabela para o estado de carregamento.
    placeholderData: keepPreviousData,
  });
}

/** A API espera `true`/`false` como texto nas flags booleanas. */
function toQueryParams(filters: JobsListFilters): Record<string, string | number | undefined> {
  return {
    search: filters.search,
    // A API espera `tech=React,Node.js`.
    tech: toCsv(filters.technologies),
    seniority: toCsv(filters.seniorities),
    source: filters.source,
    company: filters.company,
    recruiterName: filters.recruiterName,
    city: filters.city,
    isRemote: toFlag(filters.isRemote),
    includeExpired: toFlag(filters.includeExpired),
    page: filters.page,
    perPage: filters.perPage,
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
  };
}

function toFlag(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function toCsv(values: readonly string[] | undefined): string | undefined {
  return values === undefined || values.length === 0 ? undefined : values.join(',');
}
