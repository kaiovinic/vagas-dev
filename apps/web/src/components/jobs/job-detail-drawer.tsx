import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

import type { JobListItem } from '@/api/schemas';
import { JobDetail } from '@/components/jobs/job-detail';

interface JobDetailDrawerProps {
  readonly job: JobListItem | null;
  readonly onClose: () => void;
}

/**
 * Drawer lateral do celular, onde nao ha espaco para as duas colunas.
 *
 * Fica fora do fluxo do desktop (`lg:hidden`): no desktop a mesma vaga ja
 * aparece no painel fixo, e montar os dois duplicaria o conteudo para o leitor
 * de tela.
 */
export function JobDetailDrawer({ job, onClose }: JobDetailDrawerProps): ReactNode {
  // Esc fecha: o drawer cobre a tela e precisa de uma saida pelo teclado.
  useEffect(() => {
    if (!job) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [job, onClose]);

  if (!job) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 lg:hidden" data-testid="job-drawer">
      <button
        type="button"
        aria-label="Fechar detalhes"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhes da vaga ${job.title}`}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border-subtle bg-surface-raised shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <span className="text-xs tracking-wide text-content-muted uppercase">Detalhes</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-8 place-items-center rounded-lg text-content-secondary hover:bg-surface-overlay hover:text-content-primary"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <JobDetail job={job} />
        </div>
      </aside>
    </div>
  );
}
