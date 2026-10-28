import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownUp, Search } from 'lucide-react';

import type { HiringEntity } from '@/api/schemas';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { formatDateTime } from '@/lib/brasilia-time';
import { formatInteger, formatPercentage } from '@/lib/sources';

export const HIRING_SORT_OPTIONS = [
  { value: 'total', label: 'Mais vagas' },
  { value: 'recent', label: 'Publicou por ultimo' },
  { value: 'name', label: 'Nome (A-Z)' },
] as const;

type HiringSort = (typeof HIRING_SORT_OPTIONS)[number]['value'];

interface HiringEntityPanelProps {
  readonly title: string;
  readonly description: string;
  /** Rotulo da coluna de nome: "Empresa" ou "Recrutador". */
  readonly entityLabel: string;
  /** Query param usado no drill-down para a aba Vagas. */
  readonly filterParam: 'company' | 'recruiterName';
  readonly entities: readonly HiringEntity[] | undefined;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly emptyMessage: string;
}

/**
 * Tabela compartilhada pelas abas `Empresas` e `Recrutadores`: os dois endpoints
 * devolvem o mesmo agregado, so muda o rotulo e o filtro do drill-down.
 */
export function HiringEntityPanel(props: HiringEntityPanelProps): ReactNode {
  const { title, description, entityLabel, filterParam, entities, isLoading, error } = props;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<HiringSort>('total');

  const visible = useMemo(
    () => sortEntities(filterEntities(entities ?? [], search), sort),
    [entities, search, sort],
  );
  const totalJobs = visible.reduce((total, entity) => total + entity.total, 0);

  return (
    <Panel
      title={title}
      description={description}
      actions={
        <>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-content-muted"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Buscar ${entityLabel.toLowerCase()}`}
              aria-label={`Buscar ${entityLabel.toLowerCase()}`}
              className="w-52 rounded-lg border border-border-subtle bg-surface-base py-1.5 pr-3 pl-8 text-sm text-content-primary placeholder:text-content-muted"
            />
          </div>

          <label className="sr-only" htmlFor={`${filterParam}-sort`}>
            Ordenar por
          </label>
          <span className="inline-flex items-center gap-1.5">
            <ArrowDownUp aria-hidden="true" className="size-4 text-content-muted" />
            <select
              id={`${filterParam}-sort`}
              value={sort}
              onChange={(event) => setSort(event.target.value as HiringSort)}
              className="rounded-lg border border-border-subtle bg-surface-base px-2.5 py-1.5 text-sm text-content-secondary"
            >
              {HIRING_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
        </>
      }
    >
      {error !== null ? (
        <StateMessage
          title={`Nao foi possivel carregar ${title.toLowerCase()}`}
          description={error.message}
          tone="negative"
        />
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-12 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <StateMessage
          title={search.length > 0 ? 'Nada encontrado para essa busca' : props.emptyMessage}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border-subtle">
            <table className="w-full text-sm">
              <caption className="sr-only">{description}</caption>
              <thead className="bg-surface-base/60 text-xs uppercase text-content-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    {entityLabel}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Vagas
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Remotas
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Ultima vaga
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entity) => (
                  <tr key={entity.name} className="border-t border-border-subtle">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <Link
                        to={`/vagas?${filterParam}=${encodeURIComponent(entity.name)}`}
                        className="text-content-primary hover:text-accent"
                      >
                        {entity.name}
                      </Link>
                    </th>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-content-primary">
                      {formatInteger(entity.total)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-content-secondary">
                      {formatInteger(entity.remoteTotal)}
                      <span className="ml-1.5 text-xs text-content-muted">
                        {formatPercentage(toPercentage(entity.remoteTotal, entity.total))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-content-muted">
                      {formatDateTime(new Date(entity.lastPublishedAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-content-muted" data-testid="hiring-summary">
            {formatInteger(visible.length)} {entityLabel.toLowerCase()}(s) ·{' '}
            {formatInteger(totalJobs)} vaga(s) nas ultimas 72h
          </p>
        </>
      )}
    </Panel>
  );
}

function filterEntities(
  entities: readonly HiringEntity[],
  search: string,
): readonly HiringEntity[] {
  const term = search.trim().toLowerCase();

  if (term.length === 0) {
    return entities;
  }

  return entities.filter((entity) => entity.name.toLowerCase().includes(term));
}

function sortEntities(
  entities: readonly HiringEntity[],
  sort: HiringSort,
): readonly HiringEntity[] {
  const copy = [...entities];

  if (sort === 'name') {
    return copy.sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));
  }

  if (sort === 'recent') {
    return copy.sort(
      (first, second) =>
        new Date(second.lastPublishedAt).getTime() - new Date(first.lastPublishedAt).getTime(),
    );
  }

  return copy.sort((first, second) => second.total - first.total);
}

function toPercentage(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 10;
}
