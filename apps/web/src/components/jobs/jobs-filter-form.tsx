import { useId, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RotateCcw, Search } from 'lucide-react';
import { z } from 'zod';

/** Tecnologias oferecidas no filtro, iguais as do motor de regras do backend. */
export const TECHNOLOGY_OPTIONS = ['React', 'Next.js', 'Node.js', 'TypeScript', '.NET'] as const;

export const SOURCE_OPTIONS = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'gupy', label: 'Gupy' },
  { value: 'github', label: 'GitHub' },
  { value: 'remotar', label: 'Remotar' },
  { value: 'programathor', label: 'ProgramaThor' },
] as const;

/** Niveis de senioridade, iguais ao enum da API. */
export const SENIORITY_OPTIONS = [
  { value: 'INTERN', label: 'Estagio' },
  { value: 'JUNIOR', label: 'Junior' },
  { value: 'MID', label: 'Pleno' },
  { value: 'SENIOR', label: 'Senior' },
] as const;

const SENIORITY_VALUES = ['INTERN', 'JUNIOR', 'MID', 'SENIOR'] as const;

export const MARKET_SCOPE_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'NATIONAL', label: 'Nacionais' },
  { value: 'INTERNATIONAL', label: 'Internacionais' },
] as const;

export const WORK_MODE_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'remote', label: 'Apenas Remoto' },
  { value: 'local', label: 'Apenas Salvador/Presencial/Hibrido' },
] as const;

const jobsFilterSchema = z.object({
  search: z
    .string()
    .trim()
    .max(120, 'Use no maximo 120 caracteres na busca')
    .optional()
    .or(z.literal('')),
  technologies: z.array(z.enum(TECHNOLOGY_OPTIONS)),
  seniorities: z.array(z.enum(SENIORITY_VALUES)),
  workMode: z.enum(['all', 'remote', 'local']),
  scope: z.enum(['all', 'NATIONAL', 'INTERNATIONAL']),
  source: z.string(),
});

export type JobsFilterValues = z.infer<typeof jobsFilterSchema>;

export const EMPTY_JOBS_FILTER: JobsFilterValues = {
  search: '',
  technologies: [],
  seniorities: [],
  workMode: 'all',
  scope: 'all',
  source: '',
};

/**
 * Le os filtros vindos na url (a aba Mercado linka para ca), descartando valores
 * que nao existem no formulario.
 */
export function parseFilterFromParams(params: URLSearchParams): JobsFilterValues {
  const technologies = TECHNOLOGY_OPTIONS.filter((option) =>
    splitCsv(params.get('tech')).includes(option),
  );
  const seniorities = SENIORITY_VALUES.filter((value) =>
    splitCsv(params.get('seniority')).includes(value),
  );

  const scopeParam = params.get('scope') ?? '';
  const scope = MARKET_SCOPE_OPTIONS.some((option) => option.value === scopeParam)
    ? (scopeParam as JobsFilterValues['scope'])
    : 'all';

  return { ...EMPTY_JOBS_FILTER, technologies, seniorities, scope };
}

function splitCsv(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

interface JobsFilterFormProps {
  readonly onSubmit: (values: JobsFilterValues) => void;
  readonly isLoading?: boolean;
  /** Valores iniciais, quando o filtro chega pronto pela url. */
  readonly initialValues?: JobsFilterValues;
}

/**
 * Filtro avancado da aba Vagas. O submit entrega os valores ja validados pelo zod;
 * marcar uma tecnologia, trocar a modalidade ou a fonte aplica o filtro na hora,
 * enquanto a busca textual espera o submit para nao disparar a cada tecla.
 */
export function JobsFilterForm({
  onSubmit,
  isLoading = false,
  initialValues = EMPTY_JOBS_FILTER,
}: JobsFilterFormProps): ReactNode {
  const searchId = useId();
  const sourceId = useId();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<JobsFilterValues>({
    resolver: zodResolver(jobsFilterSchema),
    defaultValues: initialValues,
    mode: 'onSubmit',
  });

  /** Campos de selecao aplicam o filtro na hora, sem esperar o botao. */
  const applyOnChange = { onChange: () => void handleSubmit(onSubmit)() };

  return (
    <form
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      aria-label="Filtro avancado de vagas"
      className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface-base/50 p-4"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label htmlFor={searchId} className="mb-1 block text-xs font-medium text-content-muted">
            Busca
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-content-muted"
            />
            <input
              id={searchId}
              type="search"
              placeholder="Cargo, empresa ou stack"
              aria-invalid={errors.search !== undefined}
              {...register('search')}
              className="w-full rounded-lg border border-border-subtle bg-surface-raised py-2 pr-3 pl-8 text-sm text-content-primary placeholder:text-content-muted"
            />
          </div>
        </div>

        <div className="min-w-44">
          <label htmlFor={sourceId} className="mb-1 block text-xs font-medium text-content-muted">
            Fonte
          </label>
          <select
            id={sourceId}
            {...register('source', applyOnChange)}
            className="w-full rounded-lg border border-border-subtle bg-surface-raised px-2.5 py-2 text-sm text-content-secondary"
          >
            <option value="">Todas as fontes</option>
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-base disabled:opacity-60"
        >
          Filtrar
        </button>

        <button
          type="button"
          onClick={() => {
            reset(EMPTY_JOBS_FILTER);
            onSubmit(EMPTY_JOBS_FILTER);
          }}
          disabled={!isDirty}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-sm text-content-secondary disabled:opacity-40 hover:enabled:text-content-primary"
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          Limpar
        </button>
      </div>

      {errors.search?.message !== undefined && (
        <p role="alert" className="text-xs text-negative">
          {errors.search.message}
        </p>
      )}

      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-1 text-xs font-medium text-content-muted">Tecnologias</legend>
        {TECHNOLOGY_OPTIONS.map((technology) => (
          <label
            key={technology}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-subtle bg-surface-raised px-3 py-1.5 text-sm text-content-secondary has-checked:border-accent has-checked:text-accent"
          >
            <input
              type="checkbox"
              value={technology}
              {...register('technologies', applyOnChange)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            {technology}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-1 text-xs font-medium text-content-muted">Senioridade</legend>
        {SENIORITY_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-subtle bg-surface-raised px-3 py-1.5 text-sm text-content-secondary has-checked:border-accent has-checked:text-accent"
          >
            <input
              type="checkbox"
              value={option.value}
              {...register('seniorities', applyOnChange)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-1 text-xs font-medium text-content-muted">Mercado</legend>
        {MARKET_SCOPE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-subtle bg-surface-raised px-3 py-1.5 text-sm text-content-secondary has-checked:border-accent has-checked:text-accent"
          >
            <input
              type="radio"
              value={option.value}
              {...register('scope', applyOnChange)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-1 text-xs font-medium text-content-muted">Modalidade</legend>
        {WORK_MODE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border-subtle bg-surface-raised px-3 py-1.5 text-sm text-content-secondary has-checked:border-accent has-checked:text-accent"
          >
            <input
              type="radio"
              value={option.value}
              {...register('workMode', applyOnChange)}
              className="size-3.5 accent-[var(--color-accent)]"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </form>
  );
}

/** Traduz os valores do formulario nos query params do `useJobsList`. */
export function toJobsListFilters(values: JobsFilterValues): {
  readonly search: string | undefined;
  readonly technologies: readonly string[] | undefined;
  readonly seniorities: readonly string[] | undefined;
  readonly source: string | undefined;
  readonly isRemote: boolean | undefined;
  readonly scope: string | undefined;
} {
  const search = values.search?.trim() ?? '';

  return {
    search: search.length > 0 ? search : undefined,
    technologies: values.technologies.length > 0 ? values.technologies : undefined,
    seniorities: values.seniorities.length > 0 ? values.seniorities : undefined,
    source: values.source.length > 0 ? values.source : undefined,
    isRemote: toIsRemote(values.workMode),
    scope: values.scope === 'all' ? undefined : values.scope,
  };
}

function toIsRemote(workMode: JobsFilterValues['workMode']): boolean | undefined {
  if (workMode === 'remote') {
    return true;
  }

  return workMode === 'local' ? false : undefined;
}
