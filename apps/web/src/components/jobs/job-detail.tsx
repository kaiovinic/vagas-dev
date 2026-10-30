import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

import type { JobListItem } from '@/api/schemas';
import { PlaceBadge } from '@/components/jobs/job-feed-card';
import { StateMessage } from '@/components/ui/panel';
import { formatDateTime, formatElapsed } from '@/lib/brasilia-time';
import { sourceLabel } from '@/lib/sources';

const WORK_MODEL_LABELS: Readonly<Record<JobListItem['workModel'], string>> = {
  REMOTE: 'Remoto',
  HYBRID: 'Hibrido',
  ONSITE: 'Presencial',
  UNKNOWN: 'Nao informada',
};

const SCOPE_LABELS: Readonly<Record<JobListItem['scope'], string>> = {
  NATIONAL: 'Nacional',
  INTERNATIONAL: 'Internacional',
  UNKNOWN: 'Nao identificado',
};

/**
 * Conteudo da vaga selecionada. O mesmo componente serve o painel fixo do
 * desktop e o drawer do celular — o que muda e so o recipiente.
 */
export function JobDetail({ job }: { readonly job: JobListItem | null }): ReactNode {
  if (!job) {
    return (
      <StateMessage
        title="Selecione uma vaga"
        description="Escolha um card na lista para ver os detalhes aqui."
      />
    );
  }

  return (
    <article className="flex flex-col gap-4" data-testid="job-detail">
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-content-primary">{job.title}</h2>
        <p className="text-content-secondary">{job.company}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <PlaceBadge job={job} />
          <Chip>{WORK_MODEL_LABELS[job.workModel]}</Chip>
          {job.tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      </header>

      {/*
        Botao primario e um link de verdade: a candidatura acontece no site da
        fonte, e a pessoa pode querer abrir em outra aba ou copiar o endereco.
      */}
      <a
        href={job.url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-surface-base transition-opacity hover:opacity-90"
      >
        Candidatar-se na fonte original
        <ExternalLink aria-hidden="true" className="size-4" />
      </a>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <Meta label="Fonte" value={sourceLabel(job.source)} />
        <Meta
          label="Publicada"
          value={`${formatDateTime(new Date(job.publishedAt))} (${formatElapsed(new Date(job.publishedAt), new Date())})`}
        />
        <Meta label="Mercado" value={SCOPE_LABELS[job.scope]} />
        <Meta label="Localidade" value={job.city ?? 'Nao informada'} />
        {job.recruiterName !== null && <Meta label="Publicada por" value={job.recruiterName} />}
        {job.publishedAtSource === 'CAPTURE' && (
          <Meta label="Data" value="Estimada na captura: a fonte nao publica a data" />
        )}
      </dl>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium tracking-wide text-content-muted uppercase">
          Descricao
        </h3>
        {job.description.trim().length > 0 ? (
          // `whitespace-pre-line` preserva os paragrafos do texto da fonte sem
          // interpretar nada como HTML: o conteudo vem de terceiros.
          <p className="text-sm leading-relaxed whitespace-pre-line text-content-secondary">
            {job.description}
          </p>
        ) : (
          <p className="text-sm text-content-muted">
            Esta fonte nao publica a descricao na listagem. Abra o anuncio original para ler.
          </p>
        )}
      </section>
    </article>
  );
}

function Meta({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div>
      <dt className="text-xs text-content-muted">{label}</dt>
      <dd className="text-content-secondary">{value}</dd>
    </div>
  );
}

function Chip({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <span className="rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-content-secondary">
      {children}
    </span>
  );
}
