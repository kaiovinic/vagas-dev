import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { CaptureBlock } from '@/api/schemas';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { formatClock } from '@/lib/brasilia-time';
import { formatInteger } from '@/lib/sources';

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;

interface CapturesTimelineChartProps {
  readonly blocks: readonly CaptureBlock[] | undefined;
  /** Tamanho do bloco em horas, informado pela API. */
  readonly blockInHours: number;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

export interface TimelineRow {
  readonly label: string;
  readonly count: number;
  /** Intervalo fechado do bloco, so para o tooltip: `08:00 - 10:00`. */
  readonly range: string;
}

/**
 * Volumetria de ingestao das ultimas 24h em blocos de 2h, um por ciclo de captura.
 *
 * Responde duas perguntas que o grafico por dia nao responde: qual horario rende
 * mais oportunidade e qual ciclo passou em branco. A barra zerada por isso nao e
 * ruido, e o resultado: ela vem da API como `count: 0` e fica visivel no eixo.
 */
export function CapturesTimelineChart({
  blocks,
  blockInHours,
  isLoading,
  error,
}: CapturesTimelineChartProps): ReactNode {
  return (
    <Panel
      title="Volumetria da captura"
      description={`Vagas capturadas nas ultimas 24h, em blocos de ${blockInHours}h no horario de Brasilia`}
    >
      {renderBody({ blocks, blockInHours, isLoading, error })}
    </Panel>
  );
}

function renderBody({
  blocks,
  blockInHours,
  isLoading,
  error,
}: CapturesTimelineChartProps): ReactNode {
  if (error !== null) {
    return (
      <StateMessage
        title="Nao foi possivel carregar o grafico"
        description={error.message}
        tone="negative"
      />
    );
  }

  if (isLoading || blocks === undefined) {
    return <Skeleton className="h-56 w-full" />;
  }

  if (blocks.length === 0) {
    return (
      <StateMessage
        title="Nenhum ciclo de captura nas ultimas 24h"
        description="Assim que a proxima captura rodar, os blocos aparecem aqui."
      />
    );
  }

  const rows = blocks.map((block) => toRow(block, blockInHours));

  return (
    <div className="h-56 w-full" data-testid="captures-timeline-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
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
              <TimelineTooltip active={active === true} row={payload?.[0]?.payload as TimelineRow} />
            )}
          />
          <Bar
            dataKey="count"
            name="Vagas capturadas"
            fill="var(--color-accent)"
            // O bloco zerado desenha um tracinho na base: sem isso o Recharts
            // nao emite retangulo nenhum e o ciclo vazio some do grafico, que e
            // exatamente o que a barra explicita existe para evitar.
            minPointSize={2}
            isAnimationActive={false}
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TimelineTooltipProps {
  readonly active: boolean;
  readonly row: TimelineRow | undefined;
}

/** Tooltip proprio: o requisito e mostrar o intervalo COMPLETO, nao so o inicio. */
export function TimelineTooltip({ active, row }: TimelineTooltipProps): ReactNode {
  if (!active || row === undefined) {
    return null;
  }

  return (
    <div
      data-testid="timeline-tooltip"
      className="rounded-xl border border-border-subtle bg-surface-overlay px-3 py-2 text-xs text-content-primary shadow-lg"
    >
      <p className="font-medium">{row.range}</p>
      <p className="mt-0.5 text-content-secondary">
        {formatInteger(row.count)} {row.count === 1 ? 'vaga capturada' : 'vagas capturadas'}
      </p>
    </div>
  );
}

/** Monta a linha do grafico, fechando o intervalo do bloco no fuso de Brasilia. */
export function toRow(block: CaptureBlock, blockInHours: number): TimelineRow {
  const start = new Date(block.start);
  const end = new Date(start.getTime() + blockInHours * MILLISECONDS_IN_HOUR);

  return {
    label: block.label,
    count: block.count,
    range: `${block.label} - ${formatClock(end)}`,
  };
}
