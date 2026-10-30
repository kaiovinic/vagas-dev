import type { ReactNode } from 'react';

interface PanelProps {
  /** Opcional: o split view usa o painel so como moldura, sem cabecalho. */
  readonly title?: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/** Superficie padrao dos blocos do painel: titulo, subtitulo e area de acoes. */
export function Panel({ title, description, actions, children }: PanelProps): ReactNode {
  return (
    <section className="flex flex-col rounded-2xl border border-border-subtle bg-surface-raised p-5 shadow-lg shadow-black/20">
      {(title !== undefined || actions !== undefined) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title !== undefined && (
              <h2 className="text-base font-semibold text-content-primary">{title}</h2>
            )}
            {description !== undefined && (
              <p className="mt-0.5 text-xs text-content-muted">{description}</p>
            )}
          </div>
          {actions !== undefined && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ className = '' }: { readonly className?: string }): ReactNode {
  return (
    <div
      className={`animate-pulse rounded-lg bg-surface-overlay ${className}`}
      data-testid="skeleton"
    />
  );
}

interface StateMessageProps {
  readonly title: string;
  readonly description?: string;
  readonly tone?: 'muted' | 'negative';
}

export function StateMessage({
  title,
  description,
  tone = 'muted',
}: StateMessageProps): ReactNode {
  const titleColor = tone === 'negative' ? 'text-negative' : 'text-content-secondary';

  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
      <p className={`text-sm font-medium ${titleColor}`}>{title}</p>
      {description !== undefined && (
        <p className="text-xs text-content-muted">{description}</p>
      )}
    </div>
  );
}
