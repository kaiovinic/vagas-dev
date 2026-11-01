import { Inject, Injectable } from '@nestjs/common';

import {
  DASHBOARD_METRICS_REPOSITORY,
  type IDashboardMetricsRepository,
} from '@/domain/repositories/dashboard-metrics-repository';
import { PUBLICATION_WINDOW_IN_HOURS } from '@/domain/services/job-rule-engine';
import { toPercentage } from '@/application/use-cases/get-dashboard-summary.use-case';

export const DEFAULT_CHART_DAYS = 14;
export const CAPTURE_BLOCK_IN_HOURS = 2;
export const MAX_CHART_DAYS = 90;

export interface SourceSlice {
  readonly source: string;
  readonly total: number;
  readonly percentage: number;
}

export interface DailyStack {
  readonly day: string;
  readonly total: number;
  readonly sources: readonly SourceSlice[];
}

/** Uma barra da volumetria de captura: um bloco de 2h das ultimas 24h. */
export interface CaptureBlock {
  /** Hora de inicio do bloco no horario de Brasilia, no formato `HH:mm`. */
  readonly label: string;
  readonly count: number;
  readonly start: Date;
}

export interface DashboardCharts {
  readonly days: number;
  readonly windowInHours: number;
  /** Fontes presentes no periodo, para a legenda e a ordem das pilhas. */
  readonly sources: readonly string[];
  /** Grafico de rosca: vagas abertas das ultimas 72h por fonte. */
  readonly openJobsBySource: readonly SourceSlice[];
  /** Grafico de barras empilhadas: vagas novas por dia de publicacao, por fonte. */
  readonly newJobsByDay: readonly DailyStack[];
  /** Tamanho de cada bloco da volumetria de captura, em horas. */
  readonly captureBlockInHours: number;
  /** Volumetria de captura das ultimas 24h: 12 blocos de 2h, em ordem cronologica. */
  readonly capturesTimeline: readonly CaptureBlock[];
}

@Injectable()
export class GetDashboardChartsUseCase {
  constructor(
    @Inject(DASHBOARD_METRICS_REPOSITORY)
    private readonly metrics: IDashboardMetricsRepository,
  ) {}

  async execute(days = DEFAULT_CHART_DAYS, reference: Date = new Date()): Promise<DashboardCharts> {
    const period = normalizeDays(days);
    const [bySource, byDay, timeline] = await Promise.all([
      this.metrics.countOpenJobsBySource(reference),
      this.metrics.countJobsByDayAndSource(reference, period),
      this.metrics.findCapturesTimeline24h(reference),
    ]);

    const openTotal = bySource.reduce((total, slice) => total + slice.total, 0);

    return {
      days: period,
      windowInHours: PUBLICATION_WINDOW_IN_HOURS,
      sources: collectSources(byDay),
      openJobsBySource: bySource.map((slice) => ({
        source: slice.source,
        total: slice.total,
        percentage: toPercentage(slice.total, openTotal),
      })),
      newJobsByDay: stackByDay(byDay),
      captureBlockInHours: CAPTURE_BLOCK_IN_HOURS,
      capturesTimeline: timeline.map((block) => ({
        label: block.label,
        count: block.total,
        start: block.start,
      })),
    };
  }
}

function normalizeDays(days: number): number {
  if (!Number.isFinite(days)) {
    return DEFAULT_CHART_DAYS;
  }

  return Math.min(Math.max(Math.trunc(days), 1), MAX_CHART_DAYS);
}

function collectSources(rows: readonly { readonly source: string }[]): string[] {
  return [...new Set(rows.map((row) => row.source))].sort();
}

/** Agrupa as linhas `(dia, fonte, total)` nas barras empilhadas por dia. */
function stackByDay(
  rows: readonly { readonly day: string; readonly source: string; readonly total: number }[],
): DailyStack[] {
  const byDay = new Map<string, SourceSlice[]>();

  for (const row of rows) {
    const slices = byDay.get(row.day) ?? [];

    slices.push({ source: row.source, total: row.total, percentage: 0 });
    byDay.set(row.day, slices);
  }

  return [...byDay.entries()]
    .map(([day, slices]) => {
      const total = slices.reduce((sum, slice) => sum + slice.total, 0);

      return {
        day,
        total,
        sources: slices.map((slice) => ({
          source: slice.source,
          total: slice.total,
          percentage: toPercentage(slice.total, total),
        })),
      };
    })
    .sort((first, second) => first.day.localeCompare(second.day));
}
