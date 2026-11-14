import { useId, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { SeniorityDistribution } from '@/api/schemas';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import type { SeniorityFilters } from '@/hooks/use-seniority-distribution';
import { formatInteger, formatPercentage } from '@/lib/sources';
import {
  SENIORITY_LEVEL_IDS,
  daysInMonth,
  monthLabel,
  seniorityLabel,
  yearOptions,
} from '@/lib/seniority';

interface SeniorityChartProps {
  readonly filters: SeniorityFilters;
  readonly onFiltersChange: (filters: SeniorityFilters) => void;
  readonly distribution: SeniorityDistribution | undefined;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: Error | null;
  /** Ano de referencia dos seletores; injetado para o teste nao depender do relogio. */
  readonly currentYear?: number;
}

export interface SeniorityRow {
  readonly id: string;
  readonly label: string;
  readonly total: number;
  readonly percentage: number;
}

/**
 * Distribuicao por senioridade das vagas CAPTURADAS no recorte escolhido.
 *
 * O recorte e a data de captura, e nao a de publicacao: a pergunta e "que nivel
 * o radar trouxe neste periodo", e por isso o grafico tem calendario proprio em
 * vez de herdar a janela de 72h dos KPIs.
 */
export function SeniorityChart(props: SeniorityChartProps): ReactNode {
  const { filters, onFiltersChange, distribution, isLoading, isRefreshing, error } = props;
  const currentYear = props.currentYear ?? new Date().getUTCFullYear();
  const yearId = useId();
  const monthId = useId();
  const dayId = useId();

  return (
    <Panel
      title="Vagas por Senioridade"
      description="Por data de captura, no horario de Brasilia"
      actions={
        <CalendarControls
          filters={filters}
          onFiltersChange={onFiltersChange}
          currentYear={currentYear}
          ids={{ year: yearId, month: monthId, day: dayId }}
        />
      }
    >
      <SeniorityFilterChips filters={filters} onFiltersChange={onFiltersChange} />
      {renderChart({ distribution, isLoading, isRefreshing, error })}
    </Panel>
  );
}

interface CalendarControlsProps {
  readonly filters: SeniorityFilters;
  readonly onFiltersChange: (filters: SeniorityFilters) => void;
  readonly currentYear: number;
  readonly ids: { readonly year: string; readonly month: string; readonly day: string };
}

const SELECT_CLASS =
  'rounded-lg border border-border-subtle bg-surface-base px-2.5 py-1.5 text-sm text-content-secondary disabled:opacity-40';

function CalendarControls({
  filters,
  onFiltersChange,
  currentYear,
  ids,
}: CalendarControlsProps): ReactNode {
  const years = yearOptions(Math.max(currentYear, filters.year));

  return (
    <>
      <label className="sr-only" htmlFor={ids.year}>
        Ano do grafico
      </label>
      <select
        id={ids.year}
        value={filters.year}
        onChange={(event) => onFiltersChange(withYear(filters, Number(event.target.value)))}
        className={SELECT_CLASS}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor={ids.month}>
        Mes do grafico
      </label>
      <select
        id={ids.month}
        value={filters.month ?? ''}
        onChange={(event) => onFiltersChange(withMonth(filters, toOptional(event.target.value)))}
        className={SELECT_CLASS}
      >
        <option value="">Todos os meses</option>
        {MONTHS.map((month) => (
          <option key={month} value={month}>
            {monthLabel(month)}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor={ids.day}>
        Dia do grafico
      </label>
      <select
        id={ids.day}
        value={filters.day ?? ''}
        // Dia sem mes nao e recorte: a API recusa, e o seletor diz isso antes.
        disabled={filters.month === null}
        onChange={(event) =>
          onFiltersChange({ ...filters, day: toOptional(event.target.value) })
        }
        className={SELECT_CLASS}
      >
        <option value="">Todos os dias</option>
        {dayOptions(filters).map((day) => (
          <option key={day} value={day}>
            {day}
          </option>
        ))}
      </select>
    </>
  );
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

interface FilterChipsProps {
  readonly filters: SeniorityFilters;
  readonly onFiltersChange: (filters: SeniorityFilters) => void;
}

/**
 * Filtro de niveis. Lista vazia significa "todos", entao os chips aparecem
 * todos marcados no inicio e desmarcar um basta para esconder a barra.
 */
function SeniorityFilterChips({ filters, onFiltersChange }: FilterChipsProps): ReactNode {
  const visible = visibleLevels(filters.levels);

  return (
    <div
      role="group"
      aria-label="Niveis de senioridade"
      data-testid="seniority-filter"
      className="mb-4 flex flex-wrap gap-2"
    >
      {SENIORITY_LEVEL_IDS.map((id) => {
        const isOn = visible.has(id);

        return (
          <button
            key={id}
            type="button"
            aria-pressed={isOn}
            onClick={() => onFiltersChange({ ...filters, levels: toggleLevel(visible, id) })}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              isOn
                ? 'border-accent bg-accent/15 text-content-primary'
                : 'border-border-subtle bg-surface-base text-content-muted'
            }`}
          >
            {seniorityLabel(id, id)}
          </button>
        );
      })}
    </div>
  );
}

interface RenderChartArgs {
  readonly distribution: SeniorityDistribution | undefined;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: Error | null;
}

function renderChart({
  distribution,
  isLoading,
  isRefreshing,
  error,
}: RenderChartArgs): ReactNode {
  if (error !== null) {
    return (
      <StateMessage
        title="Nao foi possivel carregar a senioridade"
        description={error.message}
        tone="negative"
      />
    );
  }

  if (isLoading || distribution === undefined) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (distribution.levels.length === 0) {
    return (
      <StateMessage
        title="Nenhum nivel selecionado"
        description="Marque ao menos um nivel para ver a distribuicao."
      />
    );
  }

  if (distribution.total === 0) {
    return (
      <StateMessage
        title="Sem vagas capturadas no periodo"
        description="Experimente um recorte maior nos seletores acima."
      />
    );
  }

  const rows = toRows(distribution);

  return (
    <>
      <div
        className={`h-64 w-full transition-opacity ${isRefreshing ? 'opacity-60' : 'opacity-100'}`}
        data-testid="seniority-chart"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
            <XAxis
              dataKey="label"
              interval={0}
              tick={{ fill: 'var(--color-content-muted)', fontSize: 10 }}
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
              cursor={{ fill: 'var(--color-surface-overlay)', fillOpacity: 0.4 }}
              content={({ active, payload }) => (
                <SeniorityTooltip
                  active={active === true}
                  row={payload?.[0]?.payload as SeniorityRow}
                />
              )}
            />
            <Bar
              dataKey="total"
              name="Vagas capturadas"
              fill="var(--color-accent)"
              // Mesma escolha da volumetria: o nivel zerado desenha um tracinho
              // na base em vez de sumir do eixo.
              minPointSize={2}
              isAnimationActive={false}
              radius={[2, 2, 0, 0]}
            >
              <LabelList
                dataKey="total"
                position="top"
                offset={6}
                formatter={formatBarLabel}
                fill="var(--color-content-secondary)"
                fontSize={11}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 text-xs text-content-muted" data-testid="seniority-total">
        {formatInteger(distribution.filteredTotal)} de {formatInteger(distribution.total)} vagas
        capturadas no periodo
      </p>
    </>
  );
}

/** Nivel zerado nao ganha rotulo: um "0" solto sobre o tracinho so suja. */
export function formatBarLabel(value: unknown): string {
  return typeof value === 'number' && value > 0 ? formatInteger(value) : '';
}

interface SeniorityTooltipProps {
  readonly active: boolean;
  readonly row: SeniorityRow | undefined;
}

export function SeniorityTooltip({ active, row }: SeniorityTooltipProps): ReactNode {
  if (!active || row === undefined) {
    return null;
  }

  return (
    <div
      data-testid="seniority-tooltip"
      className="rounded-xl border border-border-subtle bg-surface-overlay px-3 py-2 text-xs text-content-primary shadow-lg"
    >
      <p className="font-medium">{row.label}</p>
      <p className="mt-0.5 text-content-secondary">
        {formatInteger(row.total)} {row.total === 1 ? 'vaga' : 'vagas'} ·{' '}
        {formatPercentage(row.percentage)}
      </p>
    </div>
  );
}

/** Traduz os niveis da API nas linhas do grafico, com o rotulo acentuado. */
export function toRows(distribution: SeniorityDistribution): readonly SeniorityRow[] {
  return distribution.levels.map((level) => ({
    id: level.id,
    label: seniorityLabel(level.id, level.label),
    total: level.total,
    percentage: level.percentage,
  }));
}

/** Lista vazia significa "todos": e o estado inicial do filtro. */
export function visibleLevels(levels: readonly string[]): ReadonlySet<string> {
  return levels.length === 0 ? new Set(SENIORITY_LEVEL_IDS) : new Set(levels);
}

/**
 * Marcar o ultimo nivel que faltava volta a lista ao estado "todos" (vazia),
 * para que a URL nao carregue seis parametros dizendo o mesmo que nenhum.
 */
export function toggleLevel(visible: ReadonlySet<string>, id: string): readonly string[] {
  const next = new Set(visible);

  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  if (next.size === SENIORITY_LEVEL_IDS.length) {
    return [];
  }

  return SENIORITY_LEVEL_IDS.filter((level) => next.has(level));
}

/** Trocar de ano pode encurtar o mes: 29 de fevereiro nao existe todo ano. */
function withYear(filters: SeniorityFilters, year: number): SeniorityFilters {
  return clampDay({ ...filters, year });
}

function withMonth(filters: SeniorityFilters, month: number | null): SeniorityFilters {
  // Sem mes nao ha dia: "todos os meses, dia 10" nao e recorte de calendario.
  if (month === null) {
    return { ...filters, month: null, day: null };
  }

  return clampDay({ ...filters, month });
}

function clampDay(filters: SeniorityFilters): SeniorityFilters {
  if (filters.month === null || filters.day === null) {
    return filters;
  }

  return { ...filters, day: Math.min(filters.day, daysInMonth(filters.year, filters.month)) };
}

function dayOptions(filters: SeniorityFilters): number[] {
  if (filters.month === null) {
    return [];
  }

  const total = daysInMonth(filters.year, filters.month);

  return Array.from({ length: total }, (_unused, index) => index + 1);
}

function toOptional(value: string): number | null {
  return value === '' ? null : Number(value);
}
