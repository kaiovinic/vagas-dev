import { useState, type ReactNode } from 'react';

import { CapturesTimelineChart } from '@/components/charts/captures-timeline-chart';
import { DailyStackedBarChart } from '@/components/charts/daily-stacked-bar-chart';
import { SourceDonutChart } from '@/components/charts/source-donut-chart';
import { SourceHealthTable } from '@/components/health/source-health-table';
import { KpiGrid } from '@/components/kpi/kpi-grid';
import {
  DEFAULT_CHART_DAYS,
  useDashboardCharts,
  type ChartDays,
} from '@/hooks/use-dashboard-charts';
import { useDashboardSummary } from '@/hooks/use-dashboard-summary';
import { useSourceHealth } from '@/hooks/use-source-health';

/** Legenda da tabela antes da primeira resposta; a API manda a janela real. */
const SOURCE_HEALTH_WINDOW_FALLBACK_IN_HOURS = 24;

/** Legenda do grafico de volumetria antes da primeira resposta. */
const CAPTURE_BLOCK_FALLBACK_IN_HOURS = 2;

export function DashboardPage(): ReactNode {
  const [days, setDays] = useState<ChartDays>(DEFAULT_CHART_DAYS);
  const summary = useDashboardSummary();
  const charts = useDashboardCharts(days);
  const health = useSourceHealth();

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid summary={summary.data} isLoading={summary.isPending} />

      <div className="grid gap-4 xl:grid-cols-2">
        <SourceDonutChart
          slices={charts.data?.openJobsBySource}
          windowInHours={charts.data?.windowInHours ?? summary.data?.windowInHours ?? 72}
          isLoading={charts.isPending}
          error={charts.error}
        />

        <DailyStackedBarChart
          days={days}
          onDaysChange={setDays}
          sources={charts.data?.sources}
          byDay={charts.data?.newJobsByDay}
          isLoading={charts.isPending}
          isRefreshing={charts.isFetching && !charts.isPending}
          error={charts.error}
        />
      </div>

      <CapturesTimelineChart
        blocks={charts.data?.capturesTimeline}
        blockInHours={charts.data?.captureBlockInHours ?? CAPTURE_BLOCK_FALLBACK_IN_HOURS}
        isLoading={charts.isPending}
        error={charts.error}
      />

      <SourceHealthTable
        rows={health.data?.sources}
        windowInHours={health.data?.windowInHours ?? SOURCE_HEALTH_WINDOW_FALLBACK_IN_HOURS}
        now={new Date()}
        isLoading={health.isPending}
        error={health.error}
      />
    </div>
  );
}
