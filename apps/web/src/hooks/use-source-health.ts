import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { sourceHealthSchema, type SourceHealth } from '@/api/schemas';
import { fetchJson } from '@/api/http';

/** Mesmo frescor do cabecalho de captura: o dado so muda de 2 em 2 horas. */
const SOURCE_HEALTH_STALE_TIME_MS = 60_000;

export function sourceHealthQueryKey(): readonly unknown[] {
  return ['dashboard', 'sources-health'] as const;
}

export function useSourceHealth(): UseQueryResult<SourceHealth, Error> {
  return useQuery({
    queryKey: sourceHealthQueryKey(),
    queryFn: ({ signal }) =>
      fetchJson('/api/dashboard/sources-health', sourceHealthSchema, signal),
    staleTime: SOURCE_HEALTH_STALE_TIME_MS,
  });
}
