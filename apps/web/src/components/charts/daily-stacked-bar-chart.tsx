import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { DailyStack } from '@/api/schemas';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { CHART_DAY_OPTIONS, type ChartDays } from '@/hooks/use-dashboard-charts';
import { formatDayLabel } from '@/lib/brasilia-time';
import { formatInteger, sourceColor, sourceLabel } from '@/lib/sources';

interface DailyStackedBarChartProps {
  readonly days: ChartDays;
  readonly onDaysChange: (days: ChartDays) => void;
  readonly sources: readonly string[] | undefined;
  readonly byDay: readonly DailyStack[] | undefined;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: Error | null;
}

interface ChartRow {
  readonly day: string;
  readonly label: string;
  readonly total: number;
  readonly [source: string]: string | number;
}

export function DailyStackedBarChart(props: DailyStackedBarChartProps): ReactNode {
  const { days, onDaysChange, sources, byDay, isLoading, isRefreshing, error } = props;
  const [isTableOpen, setTableOpen] = useState(false);
  const tableId = useId();
  const selectId = useId();
  const safeSources = sources ?? [];
  const rows = toChartRows(byDay ?? [], safeSources);

  return (
    <Panel
      title="Vagas novas por dia"
      description="Por dia de publicacao no horario de Brasilia, empilhadas por fonte"
      actions={
        <>
          <label className="sr-only" htmlFor={selectId}>
            Periodo do grafico
          </label>
          <select
            id={selectId}
            value={days}
            onChange={(event) => onDaysChange(Number(event.target.value) as ChartDays)}
            className="rounded-lg border border-border-subtle bg-surface-base px-2.5 py-1.5 text-sm text-content-secondary"
          >
            {CHART_DAY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} dias
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setTableOpen((open) => !open)}
            aria-expanded={isTableOpen}
            aria-controls={tableId}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-base px-2.5 py-1.5 text-sm text-content-secondary hover:text-content-primary"
          >
            {isTableOpen ? (
              <ChevronUp aria-hidden="true" className="size-4" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-4" />
            )}
            Ver tabela
          </button>
        </>
      }
    >
      {renderChart({ rows, sources: safeSources, isLoading, isRefreshing, error })}

      <div id={tableId} hidden={!isTableOpen}>
        {isTableOpen && <DailyTable rows={rows} sources={safeSources} />}
      </div>
    </Panel>
  );
}

interface RenderChartArgs {
  readonly rows: readonly ChartRow[];
  readonly sources: readonly string[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: Error | null;
}

function renderChart({
  rows,
  sources,
  isLoading,
  isRefreshing,
  error,
}: RenderChartArgs): ReactNode {
  if (error !== null) {
    return (
      <StateMessage
        title="Nao foi possivel carregar o grafico"
        description={error.message}
        tone="negative"
      />
    );
  }

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (rows.length === 0) {
    return (
      <StateMessage
        title="Sem vagas publicadas no periodo"
        description="Experimente um periodo maior no seletor acima."
      />
    );
  }

  return (
    <div
      // Enquanto o novo periodo carrega, os dados anteriores seguem na tela esmaecidos.
      className={`h-64 w-full transition-opacity ${isRefreshing ? 'opacity-60' : 'opacity-100'}`}
      data-testid="stacked-bar-chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--color-content-muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'var(--color-content-muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value: number, name: string) => [formatInteger(value), name]}
            contentStyle={{
              background: 'var(--color-surface-overlay)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: '0.75rem',
              color: 'var(--color-content-primary)',
            }}
          />
          {sources.map((source) => (
            <Bar
              key={source}
              dataKey={source}
              name={sourceLabel(source)}
              stackId="jobs"
              fill={sourceColor(source)}
              isAnimationActive={false}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface DailyTableProps {
  readonly rows: readonly ChartRow[];
  readonly sources: readonly string[];
}

function DailyTable({ rows, sources }: DailyTableProps): ReactNode {
  if (rows.length === 0) {
    return <StateMessage title="Nada para listar neste periodo" />;
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border-subtle">
      <table className="w-full text-sm">
        <caption className="sr-only">Vagas novas por dia e por fonte</caption>
        <thead className="bg-surface-base/60 text-xs uppercase text-content-muted">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Dia
            </th>
            {sources.map((source) => (
              <th key={source} scope="col" className="px-3 py-2 text-right font-medium">
                {sourceLabel(source)}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.day} className="border-t border-border-subtle">
              <th scope="row" className="px-3 py-2 text-left font-normal text-content-secondary">
                {row.label}
              </th>
              {sources.map((source) => (
                <td key={source} className="px-3 py-2 text-right tabular-nums text-content-muted">
                  {formatInteger(Number(row[source] ?? 0))}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-medium tabular-nums text-content-primary">
                {formatInteger(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Converte `[{day, sources:[{source,total}]}]` nas linhas achatadas do Recharts. */
function toChartRows(
  byDay: readonly DailyStack[],
  sources: readonly string[],
): readonly ChartRow[] {
  return byDay.map((entry) => {
    const totals: Record<string, number> = {};

    for (const source of sources) {
      totals[source] = 0;
    }

    for (const slice of entry.sources) {
      totals[slice.source] = slice.total;
    }

    return {
      ...totals,
      day: entry.day,
      label: formatDayLabel(entry.day),
      total: entry.total,
    };
  });
}
