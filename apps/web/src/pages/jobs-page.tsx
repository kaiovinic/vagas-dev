import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';

import type { JobListItem } from '@/api/schemas';
import {
  JobsFilterForm,
  parseFilterFromParams,
  toJobsListFilters,
  type JobsFilterValues,
} from '@/components/jobs/jobs-filter-form';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { useJobsList, type JobsListFilters } from '@/hooks/use-jobs-list';
import { formatDateTime } from '@/lib/brasilia-time';
import { formatInteger, sourceLabel } from '@/lib/sources';

const WORK_MODEL_LABELS: Readonly<Record<JobListItem['workModel'], string>> = {
  REMOTE: 'Remoto',
  HYBRID: 'Hibrido',
  ONSITE: 'Presencial',
  UNKNOWN: 'Nao informada',
};

export function JobsPage(): ReactNode {
  // As abas Empresas, Recrutadores e Mercado entram aqui por query param.
  const [searchParams, setSearchParams] = useSearchParams();
  // So na montagem: depois disso quem manda no filtro e o formulario.
  const [initialFilter] = useState<JobsFilterValues>(() =>
    parseFilterFromParams(searchParams),
  );
  const [applied, setApplied] = useState<JobsFilterValues>(initialFilter);
  const [page, setPage] = useState(1);
  const company = searchParams.get('company') ?? undefined;
  const recruiterName = searchParams.get('recruiterName') ?? undefined;

  const filters: JobsListFilters = {
    page,
    ...toJobsListFilters(applied),
    company,
    recruiterName,
  };
  const jobs = useJobsList(filters);

  // Cada novo filtro recomeca na primeira pagina.
  const handleFilter = useCallback((values: JobsFilterValues) => {
    setApplied(values);
    setPage(1);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [company, recruiterName]);

  const clearParam = (param: 'company' | 'recruiterName'): void => {
    const next = new URLSearchParams(searchParams);

    next.delete(param);
    setSearchParams(next, { replace: true });
  };

  return (
    <Panel
      title="Vagas abertas"
      description="Publicadas nas ultimas 72h em Salvador/BA, Regiao Metropolitana ou 100% remotas"
    >
      <div className="mb-4">
        <JobsFilterForm
          onSubmit={handleFilter}
          isLoading={jobs.isFetching}
          initialValues={initialFilter}
        />
      </div>

      {(company !== undefined || recruiterName !== undefined) && (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="drilldown-chips">
          {company !== undefined && (
            <FilterChip
              label={`Empresa: ${company}`}
              onClear={() => clearParam('company')}
            />
          )}
          {recruiterName !== undefined && (
            <FilterChip
              label={`Recrutador: ${recruiterName}`}
              onClear={() => clearParam('recruiterName')}
            />
          )}
        </div>
      )}

      {jobs.error !== null ? (
        <StateMessage
          title="Nao foi possivel carregar as vagas"
          description={jobs.error.message}
          tone="negative"
        />
      ) : jobs.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-16 w-full" />
          ))}
        </div>
      ) : jobs.data.items.length === 0 ? (
        <StateMessage
          title="Nenhuma vaga encontrada"
          description="Ajuste a busca ou aguarde a proxima captura."
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {jobs.data.items.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>

          <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-content-muted">
            <span>
              {formatInteger(jobs.data.total)} vaga(s) · pagina {jobs.data.page} de{' '}
              {Math.max(jobs.data.totalPages, 1)}
            </span>
            <span className="flex gap-2">
              <PagerButton
                label="Anterior"
                disabled={jobs.data.page <= 1}
                onClick={() => setPage((current) => Math.max(current - 1, 1))}
              />
              <PagerButton
                label="Proxima"
                disabled={jobs.data.page >= jobs.data.totalPages}
                onClick={() => setPage((current) => current + 1)}
              />
            </span>
          </footer>
        </>
      )}
    </Panel>
  );
}

interface FilterChipProps {
  readonly label: string;
  readonly onClear: () => void;
}

function FilterChip({ label, onClear }: FilterChipProps): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 py-1 pr-1.5 pl-3 text-sm text-accent">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remover filtro ${label}`}
        className="grid size-5 place-items-center rounded-full hover:bg-accent/20"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}

function JobRow({ job }: { readonly job: JobListItem }): ReactNode {
  return (
    <li className="rounded-xl border border-border-subtle bg-surface-base/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 font-medium text-content-primary hover:text-accent"
          >
            {job.title}
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
          </a>
          <p className="mt-0.5 text-sm text-content-secondary">
            {job.company}
            {job.city !== null && <span className="text-content-muted"> · {job.city}</span>}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-content-muted">
          <span>{sourceLabel(job.source)}</span>
          <span>{formatDateTime(new Date(job.publishedAt))}</span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Tag>{WORK_MODEL_LABELS[job.workModel]}</Tag>
        {job.publishedAtSource === 'CAPTURE' && <Tag>Data estimada na captura</Tag>}
        {job.tags.slice(0, 6).map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </div>
    </li>
  );
}

function Tag({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-content-secondary">
      {children}
    </span>
  );
}

interface PagerButtonProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

function PagerButton({ label, disabled, onClick }: PagerButtonProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-border-subtle bg-surface-base px-2.5 py-1 text-content-secondary disabled:opacity-40 hover:enabled:text-content-primary"
    >
      {label}
    </button>
  );
}
