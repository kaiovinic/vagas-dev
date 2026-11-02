import { describe, expect, it } from 'vitest';

import { parseMarkdown } from '@/lib/markdown';
import { splitPeriod, techItems, toResumeSections } from '@/lib/resume-sections';

function sections(markdown: string): ReturnType<typeof toResumeSections> {
  return toResumeSections(parseMarkdown(markdown));
}

describe('splitPeriod', () => {
  it('separa o periodo que fecha o titulo do cargo', () => {
    expect(splitPeriod('Desenvolvedor Full-Stack na AMVOX (2024-10 a 2026-07)')).toEqual({
      title: 'Desenvolvedor Full-Stack na AMVOX',
      period: '2024-10 a 2026-07',
    });
  });

  /** "(ADS)" e "(ERP)" fazem parte do nome: so conta parenteses com ano. */
  it('parenteses sem ano continuam no titulo', () => {
    expect(splitPeriod('Analise e Desenvolvimento de Sistemas (ADS)')).toEqual({
      title: 'Analise e Desenvolvimento de Sistemas (ADS)',
      period: null,
    });
  });

  it('projeto sem data nenhuma fica so com o titulo', () => {
    expect(splitPeriod('PrintGest - ERP para industria grafica')).toEqual({
      title: 'PrintGest - ERP para industria grafica',
      period: null,
    });
  });

  it('ano solto tambem e periodo', () => {
    expect(splitPeriod('Desenvolvimento Web - SENAC BA (2022)')).toEqual({
      title: 'Desenvolvimento Web - SENAC BA',
      period: '2022',
    });
  });
});

describe('techItems', () => {
  it('reconhece a linha de tecnologias com o rotulo em negrito', () => {
    const [block] = parseMarkdown('**Tecnologias:** React, TypeScript, Node.js');

    expect(techItems(block!)).toEqual(['React', 'TypeScript', 'Node.js']);
  });

  it('reconhece a linha sem negrito e com a lista quebrada em duas linhas', () => {
    const [block] = parseMarkdown('Tecnologias: C#, ASP.NET Core,\nMySQL');

    expect(techItems(block!)).toEqual(['C#', 'ASP.NET Core', 'MySQL']);
  });

  /** A aba Competencias tem linhas parecidas, e elas seguem texto corrido. */
  it('nao transforma a linha de competencias em etiqueta', () => {
    const [block] = parseMarkdown('**Back-End e APIs:** C#, .NET, Node.js');

    expect(techItems(block!)).toBeNull();
  });

  it('titulo e lista nao viram etiqueta', () => {
    expect(techItems({ kind: 'heading', level: 2, text: 'Tecnologias: React' })).toBeNull();
    expect(techItems({ kind: 'list', items: ['React'] })).toBeNull();
  });

  it('rotulo sem nada depois nao vira etiqueta vazia', () => {
    expect(techItems({ kind: 'paragraph', text: 'Tecnologias: ,  ,' })).toBeNull();
  });
});

describe('toResumeSections', () => {
  const CARGO = [
    '### Desenvolvedor Full-Stack na AMVOX (2024-10 a 2026-07)',
    '',
    '**Tecnologias:** React, C#',
    '',
    '- Liderou a migracao do React 17 para o React 19.',
  ].join('\n');

  it('o cargo leva junto tudo que vem sob ele', () => {
    const [entry] = sections(CARGO);

    expect(entry).toEqual({
      kind: 'entry',
      entry: {
        title: 'Desenvolvedor Full-Stack na AMVOX',
        period: '2024-10 a 2026-07',
        blocks: [
          { kind: 'paragraph', text: '**Tecnologias:** React, C#' },
          { kind: 'list', items: ['Liderou a migracao do React 17 para o React 19.'] },
        ],
      },
    });
  });

  it('o titulo da secao seguinte fecha o cargo anterior', () => {
    const result = sections(`${CARGO}\n\n## Formacao\n\n- SENAC BA`);

    expect(result.map((section) => section.kind)).toEqual(['entry', 'block', 'block']);
  });

  it('nome, contato e secoes continuam blocos soltos', () => {
    const result = sections('# Kaio Vinicius Silva\n\nSalvador, BA\n\n## Resumo');

    expect(result.every((section) => section.kind === 'block')).toBe(true);
  });

  it('dois cargos seguidos sao duas entradas independentes', () => {
    const result = sections(`${CARGO}\n\n### Analista na ARCOM (2018-05 a 2024-09)\n\n- Atuou.`);

    expect(result).toHaveLength(2);
    expect(result.every((section) => section.kind === 'entry')).toBe(true);
  });

  it('linha divisoria tambem fecha o cargo aberto', () => {
    const result = sections(`${CARGO}\n\n---\n\nTexto solto.`);

    expect(result.map((section) => section.kind)).toEqual(['entry', 'block', 'block']);
  });
});
