import type { ReactNode } from 'react';
import { MapPin, Globe } from 'lucide-react';

import type { JobListItem } from '@/api/schemas';
import { formatElapsed } from '@/lib/brasilia-time';
import { sourceLabel } from '@/lib/sources';

/** Quantas etiquetas cabem no card sem virar parede de texto. */
const MAX_TAGS = 3;

interface JobFeedCardProps {
  readonly job: JobListItem;
  readonly isActive: boolean;
  readonly onSelect: (job: JobListItem) => void;
}

/**
 * Card do feed: enxuto de proposito, para a coluna ser escaneavel.
 *
 * E um `button`, nao um link: o clique abre o painel ao lado (ou o drawer no
 * celular), nao navega. O link para a vaga original fica no painel, onde a
 * pessoa ja leu o suficiente para decidir.
 */
export function JobFeedCard({ job, isActive, onSelect }: JobFeedCardProps): ReactNode {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(job)}
        aria-current={isActive ? 'true' : undefined}
        data-testid={`job-card-${job.id}`}
        className={[
          'w-full rounded-xl border p-3 text-left transition-colors',
          isActive
            ? 'border-accent bg-accent/10'
            : 'border-border-subtle bg-surface-base/50 hover:border-border-strong hover:bg-surface-raised',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate font-medium text-content-primary">{job.title}</h3>
          <span className="shrink-0 text-xs text-content-muted">
            {formatElapsed(new Date(job.publishedAt), new Date())}
          </span>
        </div>

        <p className="mt-0.5 truncate text-sm text-content-secondary">{job.company}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PlaceBadge job={job} />
          {job.tags.slice(0, MAX_TAGS).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-content-secondary"
            >
              {tag}
            </span>
          ))}
          {job.tags.length > MAX_TAGS && (
            <span className="text-xs text-content-muted">+{job.tags.length - MAX_TAGS}</span>
          )}
          <span className="ml-auto text-xs text-content-muted">{sourceLabel(job.source)}</span>
        </div>
      </button>
    </li>
  );
}

/**
 * Distingue as duas coisas que o radar cobre: vaga da regiao e vaga remota.
 * Sao os dois motivos pelos quais uma vaga entra, e saber qual deles vale mais
 * do que repetir a modalidade.
 */
export function PlaceBadge({ job }: { readonly job: JobListItem }): ReactNode {
  if (job.isRemote) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
        <Globe aria-hidden="true" className="size-3" />
        Remoto BR
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-overlay px-2 py-0.5 text-xs text-content-secondary">
      <MapPin aria-hidden="true" className="size-3" />
      {job.city ?? 'Salvador/RMS'}
    </span>
  );
}
