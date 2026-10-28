import type { ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { SourceSlice } from '@/api/schemas';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { formatInteger, formatPercentage, sourceColor, sourceLabel } from '@/lib/sources';

interface SourceDonutChartProps {
  readonly slices: readonly SourceSlice[] | undefined;
  readonly windowInHours: number;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

export function SourceDonutChart({
  slices,
  windowInHours,
  isLoading,
  error,
}: SourceDonutChartProps): ReactNode {
  return (
    <Panel
      title="Qual site tem mais vagas"
      description={`Vagas abertas das ultimas ${windowInHours}h, por fonte`}
    >
      {renderBody({ slices, isLoading, error })}
    </Panel>
  );
}

function renderBody({
  slices,
  isLoading,
  error,
}: Pick<SourceDonutChartProps, 'slices' | 'isLoading' | 'error'>): ReactNode {
  if (error !== null) {
    return <StateMessage title="Nao foi possivel carregar o grafico" description={error.message} tone="negative" />;
  }

  if (isLoading || slices === undefined) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (slices.length === 0) {
    return (
      <StateMessage
        title="Nenhuma vaga aberta no momento"
        description="Assim que a proxima captura encontrar vagas, elas aparecem aqui."
      />
    );
  }

  const data = slices.map((slice) => ({
    ...slice,
    label: sourceLabel(slice.source),
    color: sourceColor(slice.source),
  }));

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <div className="h-56 w-full lg:w-1/2" data-testid="donut-chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={[...data]}
              dataKey="total"
              nameKey="label"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((slice) => (
                <Cell key={slice.source} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [formatInteger(value), name]}
              contentStyle={{
                background: 'var(--color-surface-overlay)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '0.75rem',
                color: 'var(--color-content-primary)',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legenda propria: o requisito e mostrar quantidade E percentual por fonte. */}
      <ul className="flex w-full flex-col gap-2 lg:w-1/2" data-testid="donut-legend">
        {data.map((slice) => (
          <li
            key={slice.source}
            className="flex items-center justify-between gap-3 rounded-lg bg-surface-base/50 px-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="truncate text-sm text-content-secondary">{slice.label}</span>
            </span>
            <span className="shrink-0 text-sm tabular-nums text-content-primary">
              {formatInteger(slice.total)}
              <span className="ml-1.5 text-xs text-content-muted">
                {formatPercentage(slice.percentage)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
