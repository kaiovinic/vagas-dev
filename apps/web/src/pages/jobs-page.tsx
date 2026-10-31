import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUp, X } from 'lucide-react';

import type { JobListItem } from '@/api/schemas';
import {
  JobsFilterForm,
  parseFilterFromParams,
  toJobsListFilters,
  type JobsFilterValues,
} from '@/components/jobs/jobs-filter-form';
import {
  DEFAULT_TIME_WINDOW,
  JobsControlBar,
  type TimeWindowHours,
} from '@/components/jobs/jobs-control-bar';
import { JobDetail } from '@/components/jobs/job-detail';
import { JobDetailDrawer } from '@/components/jobs/job-detail-drawer';
import { JobFeedCard } from '@/components/jobs/job-feed-card';
import { Panel, Skeleton, StateMessage } from '@/components/ui/panel';
import { useJobsList, type JobsListFilters } from '@/hooks/use-jobs-list';
import { LIVE_RADAR_INTERVAL_MS, useLiveRadar } from '@/hooks/use-live-radar';
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/use-media-query';
import { formatInteger } from '@/lib/sources';

export function JobsPage(): ReactNode {
  // As abas Empresas, Recrutadores e Mercado entram aqui por query param.
  const [searchParams, setSearchParams] = useSearchParams();
  // So na montagem: depois disso quem manda no filtro e o formulario.
  const [initialFilter] = useState<JobsFilterValues>(() => parseFilterFromParams(searchParams));
  const [applied, setApplied] = useState<JobsFilterValues>(initialFilter);
  const [page, setPage] = useState(1);
  const [window, setWindow] = useState<TimeWindowHours>(DEFAULT_TIME_WINDOW);
  const [isLive, setIsLive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerJob, setDrawerJob] = useState<JobListItem | null>(null);

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const company = searchParams.get('company') ?? undefined;
  const recruiterName = searchParams.get('recruiterName') ?? undefined;

  const filters: JobsListFilters = {
    page,
    withinHours: window,
    ...toJobsListFilters(applied),
    company,
    recruiterName,
  };

  const jobs = useJobsList(filters, {
    refetchInterval: isLive ? LIVE_RADAR_INTERVAL_MS : false,
  });
  const loaded = useMemo<readonly JobListItem[]>(() => jobs.data?.items ?? [], [jobs.data]);
  const radar = useLiveRadar(loaded, isLive, JSON.stringify(filters));

  const selected = loaded.find((job) => job.id === selectedId) ?? loaded[0] ?? null;

  const handleFilter = useCallback((values: JobsFilterValues) => {
    setApplied(values);
    setPage(1);
  }, []);

  // Trocar o recorte ou o alvo do filtro recomeca na primeira pagina e solta a
  // selecao: a vaga aberta pode nem existir na nova lista.
  useEffect(() => {
    setPage(1);
    setSelectedId(null);
  }, [company, recruiterName, window]);

  /**
   * No desktop a vaga vai para o painel ao lado; o drawer nem e montado. Nao
   * basta esconder com CSS: o drawer e um `role="dialog"` com o mesmo
   * conteudo, e no DOM ele faria o leitor de tela anunciar a vaga duas vezes.
   */
  const handleSelect = useCallback(
    (job: JobListItem) => {
      setSelectedId(job.id);
      setDrawerJob(isDesktop ? null : job);
    },
    [isDesktop],
  );

  const clearParam = (param: 'company' | 'recruiterName'): void => {
    const next = new URLSearchParams(searchParams);

    next.delete(param);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Vagas abertas"
        description="Publicadas nas ultimas 72h em qualquer municipio da Bahia ou 100% remotas"
      >
        <div className="flex flex-col gap-4">
          <JobsFilterForm
            onSubmit={handleFilter}
            isLoading={jobs.isFetching}
            initialValues={initialFilter}
          />

          <JobsControlBar
            window={window}
            onWindowChange={setWindow}
            isLive={isLive}
            onLiveChange={setIsLive}
            total={jobs.data?.total ?? 0}
          />

          {(company !== undefined || recruiterName !== undefined) && (
            <div className="flex flex-wrap gap-2" data-testid="drilldown-chips">
              {company !== undefined && (
                <FilterChip label={`Empresa: ${company}`} onClear={() => clearParam('company')} />
              )}
              {recruiterName !== undefined && (
                <FilterChip
                  label={`Recrutador: ${recruiterName}`}
                  onClear={() => clearParam('recruiterName')}
                />
              )}
            </div>
          )}
        </div>
      </Panel>

      {jobs.error !== null ? (
        <Panel>
          <StateMessage
            title="Nao foi possivel carregar as vagas"
            description={jobs.error.message}
            tone="negative"
          />
        </Panel>
      ) : jobs.isPending ? (
        <Panel>
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton key={row} className="h-20 w-full" />
            ))}
          </div>
        </Panel>
      ) : loaded.length === 0 ? (
        <Panel>
          <StateMessage
            title="Nenhuma vaga encontrada"
            description="Amplie o recorte de tempo, ajuste a busca ou aguarde a proxima captura."
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          {/* Feed: 2 de 5 colunas (~40%), com rolagem propria no desktop. */}
          <section className="flex flex-col gap-3 lg:col-span-2" aria-label="Lista de vagas">
            {radar.newCount > 0 && (
              <NewJobsNotice count={radar.newCount} onDismiss={radar.acknowledge} />
            )}

            <ul className="flex flex-col gap-2 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:pr-1">
              {loaded.map((job) => (
                <JobFeedCard
                  key={job.id}
                  job={job}
                  isActive={selected?.id === job.id}
                  onSelect={handleSelect}
                />
              ))}
            </ul>

            <Pager
              page={jobs.data.page}
              totalPages={jobs.data.totalPages}
              total={jobs.data.total}
              onChange={setPage}
            />
          </section>

          {/* Painel: 3 de 5 colunas (~60%), fixo ao rolar. So existe no desktop:
              no celular o mesmo conteudo vai para o drawer, e manter os dois
              no DOM faria o leitor de tela anunciar a vaga duas vezes. */}
          {isDesktop && (
            <section
              aria-label="Detalhes da vaga"
              className="lg:sticky lg:top-4 lg:col-span-3 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto"
            >
              <Panel>
                <JobDetail job={selected} />
              </Panel>
            </section>
          )}
        </div>
      )}

      <JobDetailDrawer job={drawerJob} onClose={() => setDrawerJob(null)} />
    </div>
  );
}

interface NewJobsNoticeProps {
  readonly count: number;
  readonly onDismiss: () => void;
}

/** Aviso discreto no topo do feed: informa, nao interrompe. */
function NewJobsNotice({ count, onDismiss }: NewJobsNoticeProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onDismiss}
      data-testid="new-jobs-notice"
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent hover:bg-accent/15"
    >
      <ArrowUp aria-hidden="true" className="size-4" />
      {count === 1 ? '1 vaga nova no radar' : `${count} vagas novas no radar`}
    </button>
  );
}

interface PagerProps {
  readonly page: number;
  readonly totalPages: number;
  readonly total: number;
  readonly onChange: (updater: (current: number) => number) => void;
}

function Pager({ page, totalPages, total, onChange }: PagerProps): ReactNode {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-content-muted">
      <span>
        {formatInteger(total)} vaga(s) · pagina {page} de {Math.max(totalPages, 1)}
      </span>
      <span className="flex gap-2">
        <PagerButton
          label="Anterior"
          disabled={page <= 1}
          onClick={() => onChange((current) => Math.max(current - 1, 1))}
        />
        <PagerButton
          label="Proxima"
          disabled={page >= totalPages}
          onClick={() => onChange((current) => current + 1)}
        />
      </span>
    </footer>
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
