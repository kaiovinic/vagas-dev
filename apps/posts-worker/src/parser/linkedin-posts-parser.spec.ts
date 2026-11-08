import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { parseSearchResults, type ParseResult } from '@/parser/linkedin-posts-parser';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');
}

describe('parseSearchResults, layout novo', () => {
  let result: ParseResult;

  beforeAll(() => {
    result = parseSearchResults(fixture('search-results-new-layout.html'));
  });

  it('mantem so as publicacoes aproveitaveis', () => {
    expect(result.cards.map((card) => card.author)).toEqual(['Maria Silva', 'Ana Costa']);
  });

  it('conta cada descarte por motivo', () => {
    expect(result.discarded).toEqual({
      promoted: 1,
      openToWork: 1,
      unaddressable: 0,
      withoutContent: 1,
    });
  });

  it('le autor, texto e perfil do card', () => {
    const [post] = result.cards;

    expect(post?.author).toBe('Maria Silva');
    expect(post?.authorUrl).toBe('https://www.linkedin.com/in/maria-silva-123abc');
    expect(post?.text).toContain('Estamos contratando pessoa desenvolvedora React em Salvador');
  });

  /**
   * O ponto da secao 'Por que o card nao traz a URL': neste layout o id da
   * publicacao nao esta no DOM, e o `cardKey` e o unico jeito de reencontrar o
   * card para pedir o link ao navegador.
   */
  it('nao inventa URL, e deixa a chave para o passo do navegador', () => {
    const [post] = result.cards;

    expect(post?.activityId).toBeUndefined();
    expect(post?.cardKey).toBe('update-card-focus-aaa111');
  });

  it('no layout novo nao ha subtitulo do autor para ler', () => {
    expect(result.cards[0]?.headline).toBeUndefined();
  });

  it('junta os links do anuncio e descarta a mobilia em volta', () => {
    expect(result.cards[0]?.links).toEqual([
      'https://portal.gupy.io/job/1234',
      'https://lnkd.in/dAbCdEf',
      'https://www.linkedin.com/jobs/view/4482768114',
      'https://www.linkedin.com/jobs/view/4482768115',
    ]);
  });

  it('reconhece o botao de candidatura', () => {
    expect(result.cards[0]?.hasJobAction).toBe(true);
  });

  /**
   * Regressao do bug que apareceu ao desenhar este caso: procurando a urn no
   * HTML interno, o card de fora herdaria o id do post compartilhado — e com
   * ele a data de publicacao errada, que e o dado que a janela de 72h usa.
   */
  it('nao herda a urn do post compartilhado dentro do card', () => {
    const shared = result.cards[1];

    expect(shared?.author).toBe('Ana Costa');
    expect(shared?.activityId).toBeUndefined();
  });

  it('nao trata o card de dentro como publicacao propria', () => {
    expect(result.cards.map((card) => card.author)).not.toContain('Pedro Lima');
  });
});

describe('parseSearchResults, layout classico', () => {
  let result: ParseResult;

  beforeAll(() => {
    result = parseSearchResults(fixture('search-results-classic-layout.html'));
  });

  it('le a urn do proprio card, que aqui existe', () => {
    expect(result.cards[0]?.activityId).toBe('7521262024920764416');
    expect(result.cards[0]?.cardKey).toBe('urn:li:activity:7521262024920764416');
  });

  it('le autor, subtitulo e texto das classes nomeadas', () => {
    const [post] = result.cards;

    expect(post?.author).toBe('João Pereira');
    expect(post?.headline).toBe('Tech Recruiter');
    expect(post?.text).toContain('Estamos contratando pessoa desenvolvedora .NET');
  });

  /** O link do perfil nao traz o nome: sobra o unico candidato do card. */
  it('aceita o link de perfil sem rotulo', () => {
    expect(result.cards[0]?.authorUrl).toBe('https://www.linkedin.com/in/joao-pereira');
  });

  it('post sem link nenhum devolve lista vazia, nao undefined', () => {
    expect(result.cards[0]?.links).toEqual([]);
    expect(result.cards[0]?.hasJobAction).toBe(false);
  });

  it('descarta o card com urn truncada', () => {
    expect(result.discarded.unaddressable).toBe(1);
    expect(result.cards.map((card) => card.author)).not.toContain('Fulano Sem Id');
  });

  it('le o subtitulo tambem quando ele nao tem o span interno', () => {
    expect(result.cards[1]?.headline).toBe('Recrutadora de TI');
  });

  it('deixa o autor sem URL quando o card nao tem link de perfil', () => {
    expect(result.cards[1]?.author).toBe('Beatriz Rocha');
    expect(result.cards[1]?.authorUrl).toBeUndefined();
  });

  it('le o autor tambem quando o titulo nao tem o span interno', () => {
    expect(result.cards[2]?.author).toBe('Maria Oliveira');
  });

  /** Link de perfil resolvido por JavaScript nao e URL: gravar seria gravar lixo. */
  it('recusa link de perfil nao navegavel', () => {
    expect(result.cards[2]?.authorUrl).toBeUndefined();
  });
});

describe('parseSearchResults, pagina sem publicacao', () => {
  it('devolve resultado vazio em vez de falhar', () => {
    const result = parseSearchResults('<html><body><main>Nada por aqui</main></body></html>');

    expect(result.cards).toEqual([]);
    expect(result.discarded).toEqual({
      promoted: 0,
      openToWork: 0,
      unaddressable: 0,
      withoutContent: 0,
    });
  });
});
