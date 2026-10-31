import type { ReactNode } from 'react';
import { AlertTriangle, Check, Moon } from 'lucide-react';

import type { SourceHealthRow, SourceStatus } from '@/api/schemas';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { formatElapsed, formatRemaining } from '@/lib/brasilia-time';
import { formatInteger, sourceColor, sourceLabel } from '@/lib/sources';

interface SourceHealthTableProps {
  readonly rows: readonly SourceHealthRow[] | undefined;
  readonly windowInHours: number;
  readonly now: Date;
  readonly isLoading: boolean;
  readonly error: Error | null;
}

/**
 * Aba `Dashboard`: uma linha por coletor.
 *
 * Existe porque o cabecalho de captura responde pelo conjunto: uma captura
 * `SUCCESS` com 430 vagas esconde a fonte que nao traz nada ha um dia — foi
 * exatamente o caso do Jobbol, que respondia 403 em silencio.
 */
export function SourceHealthTable({
  rows,
  windowInHours,
  now,
  isLoading,
  error,
}: SourceHealthTableProps): ReactNode {
  return (
    <Panel
      title="Saude da coleta"
      description={`Estado de cada fonte nas ultimas ${windowInHours}h`}
    >
      {renderBody({ rows, now, isLoading, error })}
    </Panel>
  );
}

function renderBody({
  rows,
  now,
  isLoading,
  error,
}: Pick<SourceHealthTableProps, 'rows' | 'now' | 'isLoading' | 'error'>): ReactNode {
  if (error !== null) {
    return (
      <StateMessage
        title="Nao foi possivel carregar a saude da coleta"
        description={error.message}
        tone="negative"
      />
    );
  }

  if (isLoading || rows === undefined) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (rows.length === 0) {
    return (
      <StateMessage
        title="Nenhuma captura registrada"
        description="A tabela se preenche na primeira execucao de cada coletor."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-sm" data-testid="source-health">
        <caption className="sr-only">Estado de cada fonte de vagas</caption>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-content-muted">
            <th scope="col" className="pb-2 pr-3 font-medium">
              Fonte
            </th>
            <th scope="col" className="pb-2 pr-3 font-medium">
              Status
            </th>
            <th scope="col" className="pb-2 pr-3 font-medium">
              Ultima execucao
            </th>
            <th scope="col" className="pb-2 pr-3 font-medium">
              Proxima
            </th>
            <th scope="col" className="pb-2 pr-3 text-right font-medium">
              Vagas lidas
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Falhas
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source} className="border-t border-border-subtle">
              <th scope="row" className="py-2.5 pr-3 font-normal text-content-primary">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: sourceColor(row.source) }}
                  />
                  {sourceLabel(row.source)}
                </span>
              </th>
              <td className="py-2.5 pr-3">
                <StatusBadge status={row.status} />
              </td>
              <td className="py-2.5 pr-3 text-content-secondary">
                {row.lastRunAt === null ? '—' : formatElapsed(new Date(row.lastRunAt), now)}
              </td>
              <td className="py-2.5 pr-3 text-content-muted">
                {row.nextRunAt === null
                  ? `a cada ${row.intervalInHours} h`
                  : `${formatRemaining(new Date(row.nextRunAt), now)} (${row.intervalInHours} h)`}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums text-content-primary">
                {formatInteger(row.totalFound)}
              </td>
              <td
                className={`py-2.5 text-right tabular-nums ${
                  row.failures > 0 ? 'text-negative' : 'text-content-muted'
                }`}
              >
                {formatInteger(row.failures)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_PRESENTATION: Readonly<
  Record<SourceStatus, { readonly label: string; readonly className: string; readonly Icon: typeof Check }>
> = {
  OK: { label: 'ok', className: 'text-positive', Icon: Check },
  // Responde, mas voltou de maos vazias: nao e falha, e tambem nao e saude.
  IDLE: { label: 'sem vagas', className: 'text-content-muted', Icon: Moon },
  FAILING: { label: 'falhando', className: 'text-negative', Icon: AlertTriangle },
};

function StatusBadge({ status }: { readonly status: SourceStatus }): ReactNode {
  const { label, className, Icon } = STATUS_PRESENTATION[status];

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${className}`} data-testid="source-status">
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}
