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
  nextcommit: { label: 'Next Commit', color: 'var(--color-source-nextcommit)' },
  inhire: { label: 'InHire', color: 'var(--color-source-inhire)' },
};

const FALLBACK: SourcePresentation = {
  label: 'Outras',
  color: 'var(--color-source-other)',
};

/**
 * Cores das fontes que ainda nao tem entrada em `SOURCES`.
 *
 * Uma fonte nova no banco aparece no grafico e na legenda sem alteracao de
 * codigo: o nome escolhe a cor por hash, entao a mesma fonte recebe sempre a
 * mesma cor em toda a interface, mesmo que o conjunto de fontes mude.
 */
const FALLBACK_PALETTE = [
  'var(--color-source-fallback-1)',
  'var(--color-source-fallback-2)',
  'var(--color-source-fallback-3)',
  'var(--color-source-fallback-4)',
  'var(--color-source-fallback-5)',
  'var(--color-source-fallback-6)',
  'var(--color-source-fallback-7)',
  'var(--color-source-fallback-8)',
] as const;

export function sourceLabel(source: string): string {
  return SOURCES[source]?.label ?? capitalize(source);
}

export function sourceColor(source: string): string {
  return SOURCES[source]?.color ?? rotatingColor(source);
}

/** Escolhe uma cor da paleta rotativa de forma estavel pelo nome da fonte. */
function rotatingColor(source: string): string {
  if (source.length === 0) {
    return FALLBACK.color;
  }

  return FALLBACK_PALETTE[hashSource(source) % FALLBACK_PALETTE.length] ?? FALLBACK.color;
}

/** Hash determinista (djb2 reduzido) para nao depender da ordem das fontes. */
function hashSource(source: string): number {
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 33 + source.charCodeAt(index)) % 0x7fffffff;
  }

  return hash;
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
