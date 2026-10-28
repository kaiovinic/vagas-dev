import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { buildPath, fetchJson } from '@/api/http';
import { dashboardChartsSchema, type DashboardCharts } from '@/api/schemas';

/** Opcoes do seletor de periodo do grafico de barras empilhadas. */
export const CHART_DAY_OPTIONS = [7, 14, 30] as const;

export type ChartDays = (typeof CHART_DAY_OPTIONS)[number];

export const DEFAULT_CHART_DAYS: ChartDays = 14;

/** Agregados mudam pouco entre capturas: 5 min evita refetch a cada navegacao. */
export const CHARTS_STALE_TIME_MS = 5 * 60_000;

export function dashboardChartsQueryKey(days: number): readonly unknown[] {
  return ['dashboard', 'charts', days] as const;
}

export function useDashboardCharts(days: number): UseQueryResult<DashboardCharts, Error> {
  return useQuery({
    queryKey: dashboardChartsQueryKey(days),
    queryFn: ({ signal }) =>
      fetchJson(buildPath('/api/dashboard/charts', { days }), dashboardChartsSchema, signal),
    staleTime: CHARTS_STALE_TIME_MS,
    // Mantem o grafico anterior na tela ao trocar 7/14/30 dias, sem piscar skeleton.
    placeholderData: keepPreviousData,
  });
}
