import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchJson } from '@/api/http';
import { seniorityDistributionSchema, type SeniorityDistribution } from '@/api/schemas';

/**
 * Recorte escolhido nos seletores do grafico.
 *
 * `month` e `day` sao `null` quando o usuario escolhe "todos"; `levels` vazio
 * significa todos os niveis, que e o estado inicial do filtro.
 */
export interface SeniorityFilters {
  readonly year: number;
  readonly month: number | null;
  readonly day: number | null;
  readonly levels: readonly string[];
}

/** Agregado por captura: 5 min, como os demais graficos do dashboard. */
export const SENIORITY_STALE_TIME_MS = 5 * 60_000;

/**
 * O filtro de senioridade vai um parametro por nivel (`?seniority=MID&...`),
 * e nao numa lista separada por virgula: e o formato que o `z.array` do
 * controller recebe sem precisar partir string.
 */
export function seniorityPath(filters: SeniorityFilters): string {
  const search = new URLSearchParams();

  search.set('year', String(filters.year));

  if (filters.month !== null) {
    search.set('month', String(filters.month));
  }

  if (filters.day !== null) {
    search.set('day', String(filters.day));
  }

  for (const level of filters.levels) {
    search.append('seniority', level);
  }

  return `/api/dashboard/seniority?${search.toString()}`;
}

export function seniorityQueryKey(filters: SeniorityFilters): readonly unknown[] {
  return ['dashboard', 'seniority', filters.year, filters.month, filters.day, filters.levels];
}

export function useSeniorityDistribution(
  filters: SeniorityFilters,
): UseQueryResult<SeniorityDistribution, Error> {
  return useQuery({
    queryKey: seniorityQueryKey(filters),
    queryFn: ({ signal }) =>
      fetchJson(seniorityPath(filters), seniorityDistributionSchema, signal),
    staleTime: SENIORITY_STALE_TIME_MS,
    // Mantem o grafico anterior na tela enquanto o novo recorte carrega.
    placeholderData: keepPreviousData,
  });
}
