import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown } from '@/lib/markdown';

describe('parseMarkdown', () => {
  it('reconhece os tres niveis de titulo', () => {
    expect(parseMarkdown('# Nome\n## Experiencia\n### Acme')).toEqual([
      { kind: 'heading', level: 1, text: 'Nome' },
      { kind: 'heading', level: 2, text: 'Experiencia' },
      { kind: 'heading', level: 3, text: 'Acme' },
    ]);
  });

  it('junta linhas seguidas num paragrafo e separa na linha vazia', () => {
    expect(parseMarkdown('Primeira linha\nsegunda linha\n\nOutro paragrafo')).toEqual([
      { kind: 'paragraph', text: 'Primeira linha\nsegunda linha' },
      { kind: 'paragraph', text: 'Outro paragrafo' },
    ]);
  });

  it('agrupa os itens de lista num unico bloco', () => {
    expect(parseMarkdown('- React\n- TypeScript\n* Node')).toEqual([
      { kind: 'list', items: ['React', 'TypeScript', 'Node'] },
    ]);
  });

  it('nao mistura paragrafo com lista: ao trocar de tipo, o anterior fecha', () => {
    expect(parseMarkdown('Competencias:\n- React\nFim do bloco')).toEqual([
      { kind: 'paragraph', text: 'Competencias:' },
      { kind: 'list', items: ['React'] },
      { kind: 'paragraph', text: 'Fim do bloco' },
    ]);
  });

  it('reconhece a linha divisoria em qualquer uma das tres formas', () => {
    expect(parseMarkdown('---\n***\n___')).toEqual([
      { kind: 'rule' },
      { kind: 'rule' },
      { kind: 'rule' },
    ]);
  });

  it('fecha o bloco pendente quando o titulo chega sem linha vazia antes', () => {
    expect(parseMarkdown('- React\n## Formacao')).toEqual([
      { kind: 'list', items: ['React'] },
      { kind: 'heading', level: 2, text: 'Formacao' },
    ]);
  });

  it('aceita o texto que termina sem quebra de linha', () => {
    expect(parseMarkdown('Ultima linha')).toEqual([
      { kind: 'paragraph', text: 'Ultima linha' },
    ]);
  });

  it('aceita quebra de linha do Windows', () => {
    expect(parseMarkdown('# Nome\r\n\r\nResumo')).toEqual([
      { kind: 'heading', level: 1, text: 'Nome' },
      { kind: 'paragraph', text: 'Resumo' },
    ]);
  });

  it('texto vazio nao vira bloco nenhum', () => {
    expect(parseMarkdown('   \n\n')).toEqual([]);
  });

  it('quatro cerquilhas nao e titulo: fica paragrafo, e nao bloco invalido', () => {
    expect(parseMarkdown('#### Nivel inexistente')).toEqual([
      { kind: 'paragraph', text: '#### Nivel inexistente' },
    ]);
  });
});

describe('parseInline', () => {
  it('separa o negrito do texto em volta', () => {
    expect(parseInline('Atuei com **React** e Node')).toEqual([
      { text: 'Atuei com ', isStrong: false },
      { text: 'React', isStrong: true },
      { text: ' e Node', isStrong: false },
    ]);
  });

  it('aceita mais de um negrito na mesma linha', () => {
    expect(parseInline('**React** e **Node**')).toEqual([
      { text: 'React', isStrong: true },
      { text: ' e ', isStrong: false },
      { text: 'Node', isStrong: true },
    ]);
  });

  it('texto sem marcacao volta inteiro, num segmento so', () => {
    expect(parseInline('Sem marcacao')).toEqual([{ text: 'Sem marcacao', isStrong: false }]);
  });

  it('asterisco solto nao abre negrito nem engole o texto', () => {
    expect(parseInline('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15', isStrong: false }]);
  });
});
