import type { MarkdownBlock } from '@/lib/markdown';

/**
 * Um cargo, projeto ou curso: o titulo, o periodo e tudo que vem sob ele ate o
 * proximo titulo. E a unidade que nao pode ser partida entre duas paginas.
 */
export interface ResumeEntry {
  readonly title: string;
  readonly period: string | null;
  readonly blocks: readonly MarkdownBlock[];
}

export type ResumeSection =
  | { readonly kind: 'block'; readonly block: MarkdownBlock }
  | { readonly kind: 'entry'; readonly entry: ResumeEntry };

/** Periodo so conta com ano dentro: "(ADS)" e parte do nome do curso. */
const PERIOD = /^(.*\S)\s*\(([^()]*\d{4}[^()]*)\)$/;
const TECH_LINE = /^\s*(?:\*\*)?\s*Tecnologias\s*:?\s*(?:\*\*)?\s*:?\s*([\s\S]+)$/i;

/**
 * Agrupa os blocos soltos do Markdown em entradas.
 *
 * O modelo devolve uma lista plana de titulos e paragrafos; o papel precisa
 * saber onde um cargo comeca e termina para nao deixar o titulo no pe de uma
 * pagina e as tecnologias no alto da seguinte.
 */
export function toResumeSections(blocks: readonly MarkdownBlock[]): ResumeSection[] {
  const sections: ResumeSection[] = [];
  let open: MarkdownBlock[] | null = null;

  for (const block of blocks) {
    if (block.kind === 'heading' && block.level === 3) {
      open = [];
      sections.push({ kind: 'entry', entry: { ...splitPeriod(block.text), blocks: open } });
      continue;
    }

    // Outro titulo, ou uma linha divisoria, fecham o cargo que estava aberto.
    if (block.kind === 'heading' || block.kind === 'rule') {
      open = null;
    }

    if (open === null) {
      sections.push({ kind: 'block', block });
      continue;
    }

    open.push(block);
  }

  return sections;
}

export function splitPeriod(heading: string): { title: string; period: string | null } {
  const match = PERIOD.exec(heading.trim());

  if (match === null) {
    return { title: heading.trim(), period: null };
  }

  return { title: match[1] ?? heading, period: match[2] ?? null };
}

/**
 * A linha "Tecnologias: React, TypeScript" vira a lista das etiquetas.
 *
 * Devolve `null` para qualquer outro paragrafo: so a linha de tecnologias de um
 * cargo ou projeto vira etiqueta, e as linhas de competencias seguem texto.
 */
export function techItems(block: MarkdownBlock): string[] | null {
  if (block.kind !== 'paragraph') {
    return null;
  }

  const match = TECH_LINE.exec(block.text);

  if (match === null) {
    return null;
  }

  const items = (match[1] ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .split(',')
    .map((item) => item.replace(/\*/g, '').trim())
    .filter((item) => item.length > 0);

  return items.length > 0 ? items : null;
}
