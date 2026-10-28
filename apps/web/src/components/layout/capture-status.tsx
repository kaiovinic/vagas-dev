import { useEffect, useState, type ReactNode } from 'react';
import { Clock, RefreshCw, TriangleAlert } from 'lucide-react';

import type { DashboardSummary } from '@/api/schemas';
import {
  BRASILIA_LABEL,
  formatClock,
  formatElapsed,
  formatRemaining,
  parseApiDate,
} from '@/lib/brasilia-time';

const TICK_INTERVAL_MS = 30_000;

/** Reavalia "ha X min" sem depender de um novo refetch da API. */
export function useNow(intervalMs: number = TICK_INTERVAL_MS): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

interface CaptureStatusProps {
  readonly capture: DashboardSummary['capture'] | undefined;
  readonly now?: Date;
}

/**
 * Subtitulo do header: fuso de Brasilia + contadores da ultima e da proxima captura.
 */
export function CaptureStatus({ capture, now }: CaptureStatusProps): ReactNode {
  const tick = useNow();
  const reference = now ?? tick;
  const lastCaptureAt = parseApiDate(capture?.lastCaptureAt ?? null);
  const nextCaptureAt = parseApiDate(capture?.nextCaptureAt ?? null);
  const failedSources = capture?.failedSources ?? [];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-content-muted">
      <span className="inline-flex items-center gap-1.5">
        <Clock aria-hidden="true" className="size-3.5" />
        {BRASILIA_LABEL}
      </span>

      <span data-testid="last-capture">
        Ultima captura:{' '}
        {lastCaptureAt === null ? (
          <strong className="font-medium text-content-muted">sem registro</strong>
        ) : (
          <strong className="font-medium text-content-secondary">
            {formatElapsed(lastCaptureAt, reference)} ({formatClock(lastCaptureAt)})
          </strong>
        )}
      </span>

      <span className="inline-flex items-center gap-1.5" data-testid="next-capture">
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Proxima captura:{' '}
        {nextCaptureAt === null ? (
          <strong className="font-medium text-content-muted">nao agendada</strong>
        ) : (
          <strong className="font-medium text-content-secondary">
            {formatRemaining(nextCaptureAt, reference)} ({formatClock(nextCaptureAt)})
          </strong>
        )}
      </span>

      {failedSources.length > 0 && (
        <span className="inline-flex items-center gap-1.5 text-warning" data-testid="failed-sources">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {failedSources.length === 1
            ? `1 fonte falhou: ${failedSources.join(', ')}`
            : `${failedSources.length} fontes falharam: ${failedSources.join(', ')}`}
        </span>
      )}
    </div>
  );
}
