import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchJson } from '@/api/http';
import { hiringEntityListSchema, type HiringEntity } from '@/api/schemas';

/** Os agregados mudam so a cada captura (2h); 5 min evita refetch a cada navegacao. */
export const HIRING_STALE_TIME_MS = 5 * 60_000;

export const companiesQueryKey = ['jobs', 'companies'] as const;
export const recruitersQueryKey = ['jobs', 'recruiters'] as const;

export function useHiringCompanies(): UseQueryResult<HiringEntity[], Error> {
  return useQuery({
    queryKey: companiesQueryKey,
    queryFn: ({ signal }) => fetchJson('/api/jobs/companies', hiringEntityListSchema, signal),
    staleTime: HIRING_STALE_TIME_MS,
  });
}

export function useHiringRecruiters(): UseQueryResult<HiringEntity[], Error> {
  return useQuery({
    queryKey: recruitersQueryKey,
    queryFn: ({ signal }) => fetchJson('/api/jobs/recruiters', hiringEntityListSchema, signal),
    staleTime: HIRING_STALE_TIME_MS,
  });
}
