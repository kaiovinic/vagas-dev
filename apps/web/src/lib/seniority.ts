/**
 * Niveis na mesma ordem que a API devolve: do estagio ao lead, com o
 * "nao especificado" sempre no fim.
 */
export const SENIORITY_LEVEL_IDS = [
  'INTERN',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD',
  'UNSPECIFIED',
] as const;

export type SeniorityLevelId = (typeof SENIORITY_LEVEL_IDS)[number];

/**
 * Rotulos acentuados vivem aqui, e nao na API.
 *
 * E a mesma divisao de `sources.ts`: o backend trafega identificadores estaveis
 * e a camada de apresentacao decide como o nome aparece na tela.
 */
const LABELS: Readonly<Record<string, string>> = {
  INTERN: 'Estágio',
  JUNIOR: 'Júnior',
  MID: 'Pleno',
  SENIOR: 'Sênior',
  LEAD: 'Lead/Especialista',
  UNSPECIFIED: 'Não especificado',
};

/**
 * Nivel que a API passar a devolver sem entrada aqui aparece com o rotulo que
 * ela mandou, em vez de sumir do grafico.
 */
export function seniorityLabel(id: string, fallback: string): string {
  return LABELS[id] ?? fallback;
}

/**
 * Uma cor por nivel, como `sources.ts` faz por fonte: a barra do grafico e a
 * bolinha do chip de filtro puxam da mesma fonte de verdade, entao o vinculo
 * visual entre filtro e barra nao depende de ninguem lembrar de atualizar dois
 * lugares. Os tons moram no tema (`global.css`).
 */
const COLORS: Readonly<Record<string, string>> = {
  INTERN: 'var(--color-seniority-intern)',
  JUNIOR: 'var(--color-seniority-junior)',
  MID: 'var(--color-seniority-mid)',
  SENIOR: 'var(--color-seniority-senior)',
  LEAD: 'var(--color-seniority-lead)',
  UNSPECIFIED: 'var(--color-seniority-unspecified)',
};

/** Nivel sem cor propria cai no neutro, em vez de desenhar barra transparente. */
export function seniorityColor(id: string): string {
  return COLORS[id] ?? 'var(--color-seniority-unspecified)';
}

export const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

export function monthLabel(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/** Quantos dias tem o mes, para o seletor nao oferecer 31 de fevereiro. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Ultimos anos, do mais recente para o mais antigo. */
export function yearOptions(currentYear: number, howMany = 5): number[] {
  return Array.from({ length: howMany }, (_unused, index) => currentYear - index);
}
