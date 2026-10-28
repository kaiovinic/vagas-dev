import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchJson } from '@/api/http';
import { dashboardSummarySchema, type DashboardSummary } from '@/api/schemas';

/** A captura roda a cada 2h; 60s de atualizacao mantem "ha X min" convincente. */
export const SUMMARY_REFETCH_INTERVAL_MS = 60_000;
export const SUMMARY_STALE_TIME_MS = 30_000;

export const dashboardSummaryQueryKey = ['dashboard', 'summary'] as const;

export function useDashboardSummary(): UseQueryResult<DashboardSummary, Error> {
  return useQuery({
    queryKey: dashboardSummaryQueryKey,
    queryFn: ({ signal }) => fetchJson('/api/dashboard/summary', dashboardSummarySchema, signal),
    staleTime: SUMMARY_STALE_TIME_MS,
    refetchInterval: SUMMARY_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
}
