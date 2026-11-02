import { afterEach, describe, expect, it, vi } from 'vitest';

import { printWithTitle, resumeDocumentTitle } from '@/lib/resume-print';

const MARKDOWN = '# Kaio Vinicius Silva\n\n## Experiencia\n- Frontend na Acme';

describe('resumeDocumentTitle', () => {
  it('junta o candidato e a empresa, que e o nome util do arquivo', () => {
    expect(resumeDocumentTitle(MARKDOWN, 'Acme Corp')).toBe(
      'Curriculo - Kaio Vinicius Silva - Acme Corp',
    );
  });

  it('vaga sem empresa informada nao deixa o nome terminar em separador', () => {
    expect(resumeDocumentTitle(MARKDOWN, null)).toBe('Curriculo - Kaio Vinicius Silva');
  });

  it('empresa em branco conta como ausente', () => {
    expect(resumeDocumentTitle(MARKDOWN, '   ')).toBe('Curriculo - Kaio Vinicius Silva');
  });

  /** O nome e o `h1`: se o modelo abriu com outra coisa, nao ha nome a usar. */
  it('curriculo que nao abre com o nome fica so com a empresa', () => {
    expect(resumeDocumentTitle('## Resumo\n\nTexto.', 'Acme Corp')).toBe('Curriculo - Acme Corp');
  });

  it('curriculo sem titulo nenhum ainda tem nome de arquivo', () => {
    expect(resumeDocumentTitle('Texto solto.', null)).toBe('Curriculo');
  });
});

describe('printWithTitle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.title = '';
  });

  it('o dialogo ve o nome do arquivo, e a aba volta ao nome de antes', () => {
    const titlesSeen: string[] = [];

    vi.stubGlobal(
      'print',
      vi.fn(() => titlesSeen.push(document.title)),
    );
    document.title = 'DevRadar';

    printWithTitle('Curriculo - Kaio - Acme');

    expect(titlesSeen).toEqual(['Curriculo - Kaio - Acme']);
    expect(document.title).toBe('DevRadar');
  });

  it('dialogo que falha nao deixa o nome do arquivo na aba', () => {
    vi.stubGlobal(
      'print',
      vi.fn(() => {
        throw new Error('impressao indisponivel');
      }),
    );
    document.title = 'DevRadar';

    expect(() => printWithTitle('Curriculo - Kaio')).toThrow('impressao indisponivel');
    expect(document.title).toBe('DevRadar');
  });
});
