import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchJson } from '@/api/http';
import { marketInsightsSchema, type MarketInsights } from '@/api/schemas';

/** Tendencia muda so a cada captura (2h). */
export const MARKET_STALE_TIME_MS = 5 * 60_000;

export const marketQueryKey = ['market'] as const;

export function useMarketInsights(): UseQueryResult<MarketInsights, Error> {
  return useQuery({
    queryKey: marketQueryKey,
    queryFn: ({ signal }) => fetchJson('/api/market', marketInsightsSchema, signal),
    staleTime: MARKET_STALE_TIME_MS,
  });
}
