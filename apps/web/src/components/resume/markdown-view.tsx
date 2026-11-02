import { useMemo, type ReactNode } from 'react';

import { parseInline, parseMarkdown, type MarkdownBlock } from '@/lib/markdown';

const HEADING_CLASS: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'text-lg font-semibold text-content-primary',
  2: 'mt-2 text-sm font-semibold tracking-wide text-content-primary uppercase',
  3: 'text-sm font-medium text-content-primary',
};

/**
 * Markdown do curriculo renderizado como texto, nunca como HTML.
 *
 * O texto vem de um modelo de linguagem: injetar `innerHTML` dele seria abrir
 * uma porta sem necessidade nenhuma. O `parseMarkdown` devolve blocos, e cada
 * bloco vira elemento React com o conteudo em nos de texto.
 */
export function MarkdownView({ markdown }: { readonly markdown: string }): ReactNode {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);

  return (
    <div className="flex flex-col gap-2" data-testid="resume-markdown">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { readonly block: MarkdownBlock }): ReactNode {
  if (block.kind === 'rule') {
    return <hr className="border-border-subtle" />;
  }

  if (block.kind === 'heading') {
    return <Heading level={block.level} text={block.text} />;
  }

  if (block.kind === 'list') {
    return (
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-content-secondary">
        {block.items.map((item, index) => (
          <li key={index}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <p className="text-sm leading-relaxed whitespace-pre-line text-content-secondary">
      <Inline text={block.text} />
    </p>
  );
}

function Heading({ level, text }: { readonly level: 1 | 2 | 3; readonly text: string }): ReactNode {
  const className = HEADING_CLASS[level];

  if (level === 1) {
    return <h3 className={className}>{text}</h3>;
  }

  if (level === 2) {
    return <h4 className={className}>{text}</h4>;
  }

  return <h5 className={className}>{text}</h5>;
}

function Inline({ text }: { readonly text: string }): ReactNode {
  return (
    <>
      {parseInline(text).map((segment, index) =>
        segment.isStrong ? (
          <strong key={index} className="font-semibold text-content-primary">
            {segment.text}
          </strong>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
