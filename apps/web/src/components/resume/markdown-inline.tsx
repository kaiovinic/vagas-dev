import type { ReactNode } from 'react';

import { parseInline } from '@/lib/markdown';

interface MarkdownInlineProps {
  readonly text: string;
  /** Vazio na impressao, onde o negrito vem da folha de estilo e nao do tema. */
  readonly strongClassName?: string;
}

/**
 * Negrito do Markdown, em nos de texto.
 *
 * Mora fora do `MarkdownView` porque a tela e a impressao renderizam a mesma
 * linha com estilos diferentes: o que nao muda e a regra de nunca interpretar
 * HTML de um texto que veio de um modelo de linguagem.
 */
export function MarkdownInline({ text, strongClassName }: MarkdownInlineProps): ReactNode {
  return (
    <>
      {parseInline(text).map((segment, index) =>
        segment.isStrong ? (
          <strong key={index} className={strongClassName}>
            {segment.text}
          </strong>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
