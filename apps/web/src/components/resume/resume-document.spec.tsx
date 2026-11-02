import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ResumeDocument } from '@/components/resume/resume-document';

const MARKDOWN = [
  '# Kaio Vinicius Silva',
  '',
  'Salvador, BA | silvasantoskaiovinicius@gmail.com',
  '',
  '## Experiencia',
  '',
  '### Desenvolvedor Full-Stack na AMVOX (2024-10 a 2026-07)',
  '',
  '**Tecnologias:** React.js, TypeScript, C#',
  '',
  '- Liderou a migracao do **React 17** para o React 19.',
  '',
  '## Competencias',
  '',
  '**Back-End e APIs:** C#, .NET, Node.js',
].join('\n');

function renderDocument(markdown = MARKDOWN): HTMLElement {
  render(<ResumeDocument markdown={markdown} />);

  return screen.getByTestId('resume-document');
}

describe('ResumeDocument', () => {
  it('o nome do candidato e o h1 da pagina, sem painel em volta', () => {
    const printable = renderDocument();

    expect(printable.querySelector('h1')?.textContent).toBe('Kaio Vinicius Silva');
    expect(printable.querySelector('h2')?.textContent).toBe('Experiencia');
  });

  /**
   * As faixas repetidas sao o que da margem as paginas 2 em diante: com
   * `@page { margin: 0 }`, sem elas o texto encosta na borda do papel.
   */
  it('o conteudo vai no corpo da tabela, entre as duas faixas repetidas', () => {
    const printable = renderDocument();
    const sheet = printable.querySelector('table.resume-sheet');

    expect(sheet?.querySelector('thead .resume-gap')).toBeInTheDocument();
    expect(sheet?.querySelector('tfoot .resume-gap')).toBeInTheDocument();
    expect(sheet?.querySelector('tbody h1')?.textContent).toBe('Kaio Vinicius Silva');
  });

  it('as faixas sao vazias: so ocupam altura', () => {
    renderDocument();

    expect(screen.getByTestId('resume-gap-top')).toBeEmptyDOMElement();
    expect(screen.getByTestId('resume-gap-bottom')).toBeEmptyDOMElement();
  });

  it('o periodo sai do titulo e vira a coluna da direita', () => {
    renderDocument();

    const heading = screen.getByTestId('resume-entry').querySelector('h3');

    expect(heading?.querySelector('.resume-entry-title')?.textContent).toBe(
      'Desenvolvedor Full-Stack na AMVOX',
    );
    expect(heading?.querySelector('.resume-entry-period')?.textContent).toBe(
      '2024-10 a 2026-07',
    );
  });

  /** O bloco inteiro e uma unidade: e nele que a folha evita a quebra. */
  it('as tecnologias e os marcadores ficam dentro do bloco do cargo', () => {
    renderDocument();

    const entry = screen.getByTestId('resume-entry');

    expect(entry).toHaveTextContent('React.js');
    expect(entry).toHaveTextContent('Liderou a migracao do React 17');
  });

  it('a linha de tecnologias vira etiquetas, uma por tecnologia', () => {
    renderDocument();

    const techs = screen.getByTestId('resume-techs');

    expect([...techs.children].map((item) => item.textContent)).toEqual([
      'React.js',
      'TypeScript',
      'C#',
    ]);
  });

  it('a linha de competencias continua texto corrido, com o rotulo em negrito', () => {
    const printable = renderDocument();

    expect(screen.getAllByTestId('resume-techs')).toHaveLength(1);
    expect(printable).toHaveTextContent('Back-End e APIs: C#, .NET, Node.js');
  });

  it('curriculo sem cargo nenhum nao inventa blocos', () => {
    renderDocument('# Kaio\n\nTexto solto.');

    expect(screen.queryByTestId('resume-entry')).not.toBeInTheDocument();
  });
});
