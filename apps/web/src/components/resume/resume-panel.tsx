import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Copy, FileDown, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';

import { ApiError } from '@/api/http';
import type { GeneratedResume, JobListItem } from '@/api/schemas';
import { MarkdownView } from '@/components/resume/markdown-view';
import { ResumeDocument } from '@/components/resume/resume-document';
import { Skeleton } from '@/components/ui/panel';
import { Toast } from '@/components/ui/toast';
import { useGenerateResume } from '@/hooks/use-generate-resume';
import { formatDateTime } from '@/lib/brasilia-time';
import { printWithTitle, resumeDocumentTitle } from '@/lib/resume-print';

/**
 * Geracao do curriculo da vaga aberta.
 *
 * O botao e sempre um clique deliberado: cada geracao custa dinheiro, e a API
 * devolve a ultima versao salva quando ja existe uma. "Gerar outra versao" e o
 * unico caminho para pagar de novo pela mesma vaga.
 */
export function ResumePanel({ job }: { readonly job: JobListItem }): ReactNode {
  const generation = useGenerateResume();
  const [copyToken, setCopyToken] = useState(0);

  const generate = (regenerate: boolean): void => {
    generation.mutate({ jobId: job.id, regenerate });
  };

  const copy = async (markdown: string): Promise<void> => {
    await navigator.clipboard.writeText(markdown);
    setCopyToken((token) => token + 1);
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface-base p-4"
      data-testid="resume-panel"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-content-primary">Curriculo sob medida</h3>
          <p className="text-xs text-content-muted">
            Seu perfil reorganizado para esta vaga, sem nada inventado.
          </p>
        </div>
        {generation.data === undefined ? (
          <GenerateButton onClick={() => generate(false)} isPending={generation.isPending} />
        ) : (
          <RegenerateButton onClick={() => generate(true)} isPending={generation.isPending} />
        )}
      </header>

      {generation.isPending && <GeneratingSkeleton />}
      {generation.error !== null && !generation.isPending && (
        <GenerationError error={generation.error} />
      )}
      {generation.data !== undefined && !generation.isPending && (
        <Result resume={generation.data} company={job.company} onCopy={copy} />
      )}

      <Toast token={copyToken} message="Curriculo copiado para a area de transferencia" />
    </section>
  );
}

interface ActionProps {
  readonly onClick: () => void;
  readonly isPending: boolean;
}

function GenerateButton({ onClick, isPending }: ActionProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-surface-base transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      <Sparkles aria-hidden="true" className="size-4" />
      {isPending ? 'Gerando...' : 'Gerar curriculo sob medida'}
    </button>
  );
}

function RegenerateButton({ onClick, isPending }: ActionProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="inline-flex items-center gap-2 rounded-xl border border-border-subtle px-3 py-2 text-sm font-medium text-content-secondary hover:text-content-primary disabled:opacity-60"
    >
      <RefreshCw aria-hidden="true" className="size-4" />
      {isPending ? 'Gerando...' : 'Gerar outra versao'}
    </button>
  );
}

/** A chamada leva alguns segundos com raciocinio ligado: a espera tem forma. */
function GeneratingSkeleton(): ReactNode {
  return (
    <div className="flex flex-col gap-2" data-testid="resume-skeleton">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-4/6" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function GenerationError({ error }: { readonly error: Error }): ReactNode {
  const status = error instanceof ApiError ? error.status : 0;

  return (
    <div
      role="alert"
      data-testid="resume-error"
      className="flex gap-2 rounded-xl border border-negative/40 bg-surface-raised px-3 py-2.5 text-sm text-content-secondary"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-negative" />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-negative">{errorTitle(status)}</p>
        <p className="text-xs">{error.message}</p>
        {status === 422 && (
          <Link to="/perfil" className="text-xs font-medium text-accent hover:underline">
            Completar o perfil
          </Link>
        )}
      </div>
    </div>
  );
}

export function errorTitle(status: number): string {
  if (status === 404) {
    return 'Essa vaga saiu do radar';
  }

  if (status === 422) {
    return 'Perfil incompleto';
  }

  if (status === 502) {
    return 'A geracao falhou no provedor';
  }

  return 'Nao foi possivel gerar o curriculo';
}

interface ResultProps {
  readonly resume: GeneratedResume;
  readonly company: string | null;
  readonly onCopy: (markdown: string) => Promise<void>;
}

function Result({ resume, company, onCopy }: ResultProps): ReactNode {
  const exportPdf = (): void => {
    printWithTitle(resumeDocumentTitle(resume.markdown, company));
  };

  return (
    <div className="flex flex-col gap-4" data-testid="resume-result">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2">
        <p className="text-xs text-content-muted">
          {resume.generated ? 'Gerado agora' : 'Versao salva'} em{' '}
          {formatDateTime(new Date(resume.generatedAt))} pelo {resume.model}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void onCopy(resume.markdown)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs text-content-secondary hover:text-content-primary"
          >
            <Copy aria-hidden="true" className="size-3.5" />
            Copiar Markdown
          </button>
          <button
            type="button"
            onClick={exportPdf}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
          >
            <FileDown aria-hidden="true" className="size-3.5" />
            Exportar PDF
          </button>
        </div>
      </div>

      <MarkdownView markdown={resume.markdown} />

      {/* Fora da tela: so o papel ve. E o que o "Exportar PDF" imprime. */}
      <ResumeDocument markdown={resume.markdown} />

      <GapList gaps={resume.gaps} />

      {resume.rationale.length > 0 && (
        <details className="rounded-xl border border-border-subtle px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-content-secondary">
            Como foi montado
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-content-muted">
            {resume.rationale.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * As lacunas sao a parte mais util do retorno: dizem na hora se vale aplicar e
 * o que estudar. Por isso ficam abertas, e nao atras de um clique.
 */
function GapList({ gaps }: { readonly gaps: readonly string[] }): ReactNode {
  if (gaps.length === 0) {
    return (
      <p className="text-xs text-positive" data-testid="resume-gaps">
        Seu perfil cobre todos os requisitos que a vaga declara.
      </p>
    );
  }

  // Caixa propria, e nao mais uma secao do texto: o que esta aqui e analise
  // nossa sobre a vaga, nao conteudo do curriculo que vai ser enviado.
  return (
    <section
      className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2.5"
      data-testid="resume-gaps"
    >
      <h4 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-content-primary uppercase">
        <TriangleAlert aria-hidden="true" className="size-3.5 text-negative" />O que ficou de fora
      </h4>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-content-secondary">
        {gaps.map((gap, index) => (
          <li key={index}>{gap}</li>
        ))}
      </ul>
    </section>
  );
}
