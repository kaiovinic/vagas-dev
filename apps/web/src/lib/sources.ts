interface SourcePresentation {
  readonly label: string;
  readonly color: string;
}

/** Rotulo e cor fixos por fonte, para a rosca e as barras usarem a mesma cor. */
const SOURCES: Readonly<Record<string, SourcePresentation>> = {
  linkedin: { label: 'LinkedIn', color: 'var(--color-source-linkedin)' },
  gupy: { label: 'Gupy', color: 'var(--color-source-gupy)' },
  github: { label: 'GitHub', color: 'var(--color-source-github)' },
  remotar: { label: 'Remotar', color: 'var(--color-source-remotar)' },
  programathor: { label: 'ProgramaThor', color: 'var(--color-source-programathor)' },
  jobbol: { label: 'Jobbol', color: 'var(--color-source-jobbol)' },
  solides: { label: 'Sólides', color: 'var(--color-source-solides)' },
  coodesh: { label: 'Coodesh', color: 'var(--color-source-coodesh)' },
  'linkedin-posts': { label: 'Publicação LinkedIn', color: 'var(--color-source-linkedin-posts)' },
};

const FALLBACK: SourcePresentation = {
  label: 'Outras',
  color: 'var(--color-source-other)',
};

export function sourceLabel(source: string): string {
  return SOURCES[source]?.label ?? capitalize(source);
}

export function sourceColor(source: string): string {
  return SOURCES[source]?.color ?? FALLBACK.color;
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return FALLBACK.label;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

export function formatPercentage(value: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}
