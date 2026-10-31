import { useId, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { z } from 'zod';

import type { RejectionReason, RulesTestResult } from '@/api/schemas';
import { Panel, StateMessage } from '@/components/ui/panel';
import { useTestRules } from '@/hooks/use-rules';

const MIN_TEXT_LENGTH = 10;

const testerSchema = z
  .object({
    text: z.string().trim().max(20_000, 'Texto muito longo (maximo 20.000 caracteres)'),
    company: z.string().trim().max(200).optional(),
    location: z.string().trim().max(200).optional(),
    url: z.string().trim().max(2_000).optional(),
  })
  .refine(
    (values) => values.text.length >= MIN_TEXT_LENGTH || (values.url ?? '').length > 0,
    {
      message: `Cole ao menos ${MIN_TEXT_LENGTH} caracteres da publicacao, ou informe o link da vaga`,
      path: ['text'],
    },
  );

export type PublicationTesterValues = z.infer<typeof testerSchema>;

const REJECTION_LABELS: Readonly<Record<RejectionReason, string>> = {
  EXPIRED_PUBLICATION: 'Fora da janela de 72h',
  STACK_NOT_MATCHED: 'Nao cita a stack monitorada',
  LOCATION_NOT_ALLOWED: 'Nao e remota nem da Bahia',
  SPAM_DETECTED: 'Bloqueada pelo filtro anti-spam',
};

/**
 * Testador de Publicacao: o usuario cola o texto de um post ou a descricao da vaga
 * e ve se passaria no filtro, com os termos que deram match e a regra que bloqueou.
 */
export function PublicationTesterForm(): ReactNode {
  const textId = useId();
  const companyId = useId();
  const locationId = useId();
  const urlId = useId();
  const test = useTestRules();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PublicationTesterValues>({
    resolver: zodResolver(testerSchema),
    defaultValues: { text: '', company: '', location: '', url: '' },
  });

  return (
    <Panel
      title="Testador de Publicacao"
      description="Cole um post do LinkedIn ou a descricao de uma vaga e veja se ela passaria no filtro"
    >
      <form
        onSubmit={(event) => void handleSubmit((values) => test.mutate(values))(event)}
        aria-label="Testador de publicacao"
        className="flex flex-col gap-3"
      >
        <div>
          <label htmlFor={textId} className="mb-1 block text-xs font-medium text-content-muted">
            Texto da publicacao
          </label>
          <textarea
            id={textId}
            rows={6}
            placeholder="Cole aqui o texto do post ou a descricao da vaga"
            aria-invalid={errors.text !== undefined}
            {...register('text')}
            className="w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-2 text-sm text-content-primary placeholder:text-content-muted"
          />
          {errors.text?.message !== undefined && (
            <p role="alert" className="mt-1 text-xs text-negative">
              {errors.text.message}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <TextField id={companyId} label="Empresa (opcional)" {...register('company')} />
          <TextField id={locationId} label="Localidade (opcional)" {...register('location')} />
          <TextField id={urlId} label="Link da vaga (opcional)" {...register('url')} />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={test.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-base disabled:opacity-60"
          >
            {test.isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            Validar Regra
          </button>
        </div>
      </form>

      {test.error !== null && (
        <div className="mt-4">
          <StateMessage
            title="Nao foi possivel validar a publicacao"
            description={test.error.message}
            tone="negative"
          />
        </div>
      )}

      {test.data !== undefined && test.error === null && <TestResult result={test.data} />}
    </Panel>
  );
}

interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly name: string;
}

const TextField = ({
  id,
  label,
  ...field
}: TextFieldProps & Record<string, unknown>): ReactNode => (
  <div>
    <label htmlFor={id} className="mb-1 block text-xs font-medium text-content-muted">
      {label}
    </label>
    <input
      id={id}
      type="text"
      {...field}
      className="w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-2 text-sm text-content-primary"
    />
  </div>
);

function TestResult({ result }: { readonly result: RulesTestResult }): ReactNode {
  return (
    <section
      aria-live="polite"
      data-testid="tester-result"
      className="mt-5 rounded-xl border border-border-subtle bg-surface-base/50 p-4"
    >
      <h3
        className={`flex items-center gap-2 text-sm font-semibold ${
          result.approved ? 'text-positive' : 'text-negative'
        }`}
      >
        {result.approved ? (
          <CircleCheck aria-hidden="true" className="size-4" />
        ) : (
          <CircleX aria-hidden="true" className="size-4" />
        )}
        {result.approved ? 'Passaria no filtro' : 'Seria descartada'}
      </h3>

      {result.rejectionReasons.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" data-testid="rejection-reasons">
          {result.rejectionReasons.map((reason) => (
            <li
              key={reason}
              className="rounded-full bg-negative/15 px-2.5 py-1 text-xs text-negative"
            >
              {REJECTION_LABELS[reason]}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MatchList title="Stack encontrada" items={result.matchedStack} tone="positive" />
        <MatchList title="Localidade aceita" items={result.matchedLocations} tone="positive" />
        <MatchList title="Termos bloqueados" items={result.matchedSpamTerms} tone="negative" />
      </div>

      <p className="mt-4 text-xs text-content-muted">
        Avaliado como <strong className="text-content-secondary">{result.evaluated.title}</strong>{' '}
        em <strong className="text-content-secondary">{result.evaluated.company}</strong>
      </p>
    </section>
  );
}

interface MatchListProps {
  readonly title: string;
  readonly items: readonly string[];
  readonly tone: 'positive' | 'negative';
}

function MatchList({ title, items, tone }: MatchListProps): ReactNode {
  const chipTone =
    tone === 'positive' ? 'bg-positive/15 text-positive' : 'bg-negative/15 text-negative';

  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium text-content-muted">{title}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-content-muted">Nenhum</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item} className={`rounded-full px-2 py-0.5 text-xs ${chipTone}`}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
