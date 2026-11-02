import { useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { MarkdownInline } from '@/components/resume/markdown-inline';
import { parseMarkdown, type MarkdownBlock } from '@/lib/markdown';
import {
  techItems,
  toResumeSections,
  type ResumeEntry,
  type ResumeSection,
} from '@/lib/resume-sections';

/**
 * O curriculo como documento proprio, fora do `#root`, so para a impressao.
 *
 * Imprimir a tela daria uma pagina escura e cortada: o painel tem fundo escuro e
 * rola dentro de dois contenedores. Aqui o mesmo Markdown vira HTML semantico
 * que a folha de impressao do `global.css` formata em A4.
 *
 * As lacunas e o racional ficam de fora de proposito: sao analise nossa sobre a
 * vaga, nao conteudo do curriculo que vai ser enviado.
 */
export function ResumeDocument({ markdown }: { readonly markdown: string }): ReactNode {
  const sections = useMemo(() => toResumeSections(parseMarkdown(markdown)), [markdown]);

  return createPortal(
    // `aria-hidden`: na tela o documento e `display: none`, mas a copia do
    // texto nao tem nada a dizer ao leitor de tela nem aqui nem no papel.
    <article className="resume-print" aria-hidden="true" data-testid="resume-document">
      {sections.map((section, index) => (
        <Section key={index} section={section} />
      ))}
    </article>,
    document.body,
  );
}

function Section({ section }: { readonly section: ResumeSection }): ReactNode {
  if (section.kind === 'entry') {
    return <Entry entry={section.entry} />;
  }

  return <PrintBlock block={section.block} />;
}

/** Cargo, projeto ou curso inteiro: o `avoid` da folha mantem tudo junto. */
function Entry({ entry }: { readonly entry: ResumeEntry }): ReactNode {
  return (
    <section className="resume-entry" data-testid="resume-entry">
      <h3>
        <span className="resume-entry-title">{entry.title}</span>
        {entry.period !== null && <span className="resume-entry-period">{entry.period}</span>}
      </h3>
      {entry.blocks.map((block, index) => (
        <PrintBlock key={index} block={block} />
      ))}
    </section>
  );
}

function PrintBlock({ block }: { readonly block: MarkdownBlock }): ReactNode {
  const techs = techItems(block);

  if (techs !== null) {
    return <TechList items={techs} />;
  }

  if (block.kind === 'rule') {
    return <hr />;
  }

  if (block.kind === 'heading') {
    return <PrintHeading level={block.level} text={block.text} />;
  }

  if (block.kind === 'list') {
    return (
      <ul>
        {block.items.map((item, index) => (
          <li key={index}>
            <MarkdownInline text={item} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <p>
      <MarkdownInline text={block.text} />
    </p>
  );
}

/**
 * As tecnologias do cargo viram etiquetas.
 *
 * Numa leitura de trinta segundos, a pilha e o que o recrutador procura
 * primeiro: separada do texto corrido, ela se acha de relance.
 */
function TechList({ items }: { readonly items: readonly string[] }): ReactNode {
  return (
    <ul className="resume-techs" data-testid="resume-techs">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * Na impressao o nivel do Markdown vira o nivel real do documento.
 *
 * Na tela os titulos comecam em `h3` para nao competir com o cabecalho do
 * painel; a folha impressa nao tem painel em volta, e o nome do candidato e o
 * `h1` da pagina.
 */
function PrintHeading({
  level,
  text,
}: {
  readonly level: 1 | 2 | 3;
  readonly text: string;
}): ReactNode {
  if (level === 1) {
    return <h1>{text}</h1>;
  }

  if (level === 2) {
    return <h2>{text}</h2>;
  }

  return <h3>{text}</h3>;
}
