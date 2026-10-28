import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp, Minus, type LucideIcon } from 'lucide-react';

import { Skeleton } from '@/components/ui/panel';
import { formatInteger } from '@/lib/sources';

interface KpiCardProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly caption: string;
  readonly icon: LucideIcon;
  /** Variacao em relacao ao periodo anterior, exibida como `▲ +X vs. 24h anteriores`. */
  readonly delta?: number | undefined;
  readonly deltaCaption?: string;
  readonly isLoading?: boolean;
}

export function KpiCard({
  label,
  value,
  caption,
  icon: Icon,
  delta,
  deltaCaption,
  isLoading = false,
}: KpiCardProps): ReactNode {
  return (
    <article className="rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-lg shadow-black/20">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-content-muted uppercase">{label}</p>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </div>

      {isLoading || value === undefined ? (
        <Skeleton className="mt-3 h-9 w-24" />
      ) : (
        <p className="mt-2 text-3xl font-semibold tabular-nums text-content-primary">
          {formatInteger(value)}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {delta !== undefined && !isLoading && (
          <DeltaBadge delta={delta} caption={deltaCaption ?? 'vs. periodo anterior'} />
        )}
        <p className="text-xs text-content-muted">{caption}</p>
      </div>
    </article>
  );
}

interface DeltaBadgeProps {
  readonly delta: number;
  readonly caption: string;
}

function DeltaBadge({ delta, caption }: DeltaBadgeProps): ReactNode {
  const { Icon, tone, sign } = describeDelta(delta);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${tone}`}
      data-testid="kpi-delta"
    >
      <Icon aria-hidden="true" className="size-3" />
      {sign}
      {formatInteger(Math.abs(delta))} {caption}
    </span>
  );
}

function describeDelta(delta: number): {
  Icon: LucideIcon;
  tone: string;
  sign: string;
} {
  if (delta > 0) {
    return { Icon: TrendingUp, tone: 'bg-positive/15 text-positive', sign: '+' };
  }

  if (delta < 0) {
    return { Icon: TrendingDown, tone: 'bg-negative/15 text-negative', sign: '-' };
  }

  return { Icon: Minus, tone: 'bg-surface-overlay text-content-muted', sign: '' };
}
