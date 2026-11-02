/**
 * Markdown minimo, so o que o gerador de curriculo produz: titulos, listas,
 * paragrafos, linha divisoria e negrito.
 *
 * Nao e uma biblioteca de Markdown, e de proposito. O texto vem de um modelo,
 * entao renderizar HTML dele seria abrir uma porta que ninguem precisa: aqui o
 * resultado e sempre uma arvore de nos de texto. Um `![imagem](url)` aparece
 * como texto puro em vez de virar requisicao para fora.
 */
export type MarkdownBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[] }
  | { readonly kind: 'rule' };

export interface InlineSegment {
  readonly text: string;
  readonly isStrong: boolean;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const STRONG = /\*\*([^*]+)\*\*/g;

interface Pending {
  readonly kind: 'paragraph' | 'list';
  readonly lines: string[];
}

export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let pending: Pending | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    const block = toBlock(trimmed);

    if (trimmed.length === 0 || block !== null) {
      blocks.push(...close(pending), ...(block === null ? [] : [block]));
      pending = null;
      continue;
    }

    pending = append(pending, trimmed, blocks);
  }

  blocks.push(...close(pending));

  return blocks;
}

/** Lista e paragrafo nao se misturam: ao trocar de tipo, o anterior fecha. */
function append(pending: Pending | null, line: string, blocks: MarkdownBlock[]): Pending {
  const bullet = BULLET.exec(line);
  const kind = bullet === null ? 'paragraph' : 'list';
  const text = bullet === null ? line : (bullet[1]?.trim() ?? '');

  if (pending?.kind === kind) {
    pending.lines.push(text);

    return pending;
  }

  blocks.push(...close(pending));

  return { kind, lines: [text] };
}

function close(pending: Pending | null): MarkdownBlock[] {
  if (pending === null) {
    return [];
  }

  if (pending.kind === 'list') {
    return [{ kind: 'list', items: [...pending.lines] }];
  }

  return [{ kind: 'paragraph', text: pending.lines.join('\n') }];
}

/** Quebra o negrito em segmentos, para o render nunca interpretar HTML. */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(STRONG)) {
    const start = match.index;

    pushText(segments, text.slice(cursor, start));
    segments.push({ text: match[1] ?? '', isStrong: true });
    cursor = start + match[0].length;
  }

  pushText(segments, text.slice(cursor));

  return segments;
}

function toBlock(line: string): MarkdownBlock | null {
  if (RULE.test(line)) {
    return { kind: 'rule' };
  }

  const heading = HEADING.exec(line);

  if (heading === null) {
    return null;
  }

  return {
    kind: 'heading',
    level: (heading[1]?.length ?? 1) as 1 | 2 | 3,
    text: heading[2]?.trim() ?? '',
  };
}




function pushText(segments: InlineSegment[], text: string): void {
  if (text.length > 0) {
    segments.push({ text, isStrong: false });
  }
}
