import type { ReactNode } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { useRunCapture } from '@/hooks/use-run-capture';
import { formatInteger } from '@/lib/sources';

/** Dispara uma captura agora, sem esperar o cron de 2h. */
export function CaptureButton(): ReactNode {
  const capture = useRunCapture();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => capture.mutate()}
        disabled={capture.isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-base px-3 py-1.5 text-sm text-content-secondary disabled:opacity-60 hover:enabled:text-content-primary"
      >
        {capture.isPending ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden="true" className="size-3.5" />
        )}
        {capture.isPending ? 'Capturando...' : 'Capturar agora'}
      </button>

      {capture.error !== null && (
        <span role="alert" className="text-xs text-negative">
          {capture.error.message}
        </span>
      )}

      {capture.data !== undefined && capture.error === null && !capture.isPending && (
        <span className="text-xs text-content-muted" data-testid="capture-result">
          {describe(capture.data)}
        </span>
      )}
    </div>
  );
}

function describe(result: {
  readonly totalFound: number;
  readonly totalPersisted: number;
  readonly failedSources: readonly string[];
}): string {
  const base =
    result.totalPersisted === 0
      ? `${formatInteger(result.totalFound)} publicacoes varridas, nenhuma vaga nova`
      : `${formatInteger(result.totalFound)} publicacoes varridas, ${formatInteger(result.totalPersisted)} vaga(s) nova(s)`;

  if (result.failedSources.length === 0) {
    return base;
  }

  return `${base} · falhou: ${result.failedSources.join(', ')}`;
}
