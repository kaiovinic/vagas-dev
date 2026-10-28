const DIACRITIC_MARKS = /[̀-ͯ]/g;
const NON_ALPHANUMERIC = /[^a-z0-9]/g;
const WHITESPACE_RUN = /\s+/g;
const REGEXP_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;
const INNER_SEPARATOR_RUN = /([a-z0-9])[\s\-_./]+(?=[a-z0-9])/g;
const FLEXIBLE_SEPARATOR = '[\\s\\-_./]*';
const SEPARATOR_PLACEHOLDER = '\u0000';
const ALPHANUMERIC_CHAR = /^[a-z0-9]$/;

/** Grupo de palavras-chave: um rotulo publico e as variacoes aceitas na captura. */
export interface KeywordGroup {
  readonly label: string;
  readonly aliases: readonly string[];
}

/** Grupo de palavras-chave com as expressoes regulares ja compiladas. */
export interface CompiledKeywordGroup {
  readonly label: string;
  readonly matchers: readonly RegExp[];
}

export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(DIACRITIC_MARKS, '');
}

/** Texto em minusculas, sem acentos e com espacos colapsados, pronto para casar palavras-chave. */
export function normalizeForMatching(value: string): string {
  return stripDiacritics(value).toLowerCase().replace(WHITESPACE_RUN, ' ').trim();
}

/** Texto reduzido a letras e numeros, usado como base estavel do fingerprint. */
export function normalizeForFingerprint(value: string): string {
  return stripDiacritics(value).toLowerCase().replace(NON_ALPHANUMERIC, '');
}

export function compileKeywordGroups(
  groups: readonly KeywordGroup[],
): readonly CompiledKeywordGroup[] {
  return groups.map((group) => ({
    label: group.label,
    matchers: group.aliases.map(buildAliasMatcher),
  }));
}

/** Rotulos cujos aliases aparecem no texto, na ordem declarada no catalogo. */
export function matchKeywordLabels(
  normalizedText: string,
  groups: readonly CompiledKeywordGroup[],
): string[] {
  return groups
    .filter((group) => group.matchers.some((matcher) => matcher.test(normalizedText)))
    .map((group) => group.label);
}

function buildAliasMatcher(alias: string): RegExp {
  const normalized = normalizeForMatching(alias);
  const body = buildFlexibleBody(normalized);
  const prefix = startsWithAlphanumeric(normalized) ? '(?<![a-z0-9])' : '';
  const suffix = endsWithAlphanumeric(normalized) ? '(?![a-z0-9])' : '';

  return new RegExp(`${prefix}${body}${suffix}`);
}

/**
 * Torna flexiveis apenas os separadores internos ("node.js" casa "nodejs", "node js" e "node-js"),
 * preservando separadores de borda como o ponto de ".net".
 */
function buildFlexibleBody(normalizedAlias: string): string {
  const withPlaceholders = normalizedAlias.replace(
    INNER_SEPARATOR_RUN,
    `$1${SEPARATOR_PLACEHOLDER}`,
  );

  return escapeRegExp(withPlaceholders).split(SEPARATOR_PLACEHOLDER).join(FLEXIBLE_SEPARATOR);
}

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIAL_CHARS, '\\$&');
}

function startsWithAlphanumeric(value: string): boolean {
  return ALPHANUMERIC_CHAR.test(value.charAt(0));
}

function endsWithAlphanumeric(value: string): boolean {
  return ALPHANUMERIC_CHAR.test(value.charAt(value.length - 1));
}
