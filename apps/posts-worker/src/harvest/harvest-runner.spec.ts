import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EMPTY_HARVEST, type HarvestDiscards, type HarvestFile } from '@/contract';
import { runHarvest, type HarvestRunnerDeps } from '@/harvest/harvest-runner';
import type { PostsPage, SearchOpening } from '@/harvest/posts-page';
import { PAUSE_BETWEEN_SEARCHES_IN_MS, type PostsSearch } from '@/harvest/searches';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'parser', 'fixtures', name), 'utf8');
}

/** As mesmas fixtures do parser: o runner e testado contra o layout de verdade. */
const CLASSIC_LAYOUT = fixture('search-results-classic-layout.html');

const NEW_LAYOUT = fixture('search-results-new-layout.html');

const EMPTY_PAGE = '<html><body><main>Nada por aqui</main></body></html>';

const OPENED: SearchOpening = { outcome: 'opened' };

const NOW = new Date('2026-11-07T12:00:00.000Z');

const SEARCHES: readonly PostsSearch[] = [
  { label: 'Bahia', keywords: 'vaga desenvolvedor Salvador Bahia' },
  { label: 'Remoto nacional', keywords: 'vaga desenvolvedor react remoto' },
];

/** URLs canonicas dos tres cards do layout classico, na ordem da pagina. */
const CLASSIC_URLS = [
  'https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416/',
  'https://www.linkedin.com/feed/update/urn:li:activity:7521249835149062144/',
  'https://www.linkedin.com/feed/update/urn:li:activity:7521249835149062145/',
];

const NOTHING_DISCARDED: HarvestDiscards = {
  promoted: 0,
  openToWork: 0,
  unaddressable: 0,
  withoutContent: 0,
  withoutUrl: 0,
};

/** Uma colheita de ontem, para provar o que sobrevive a um dia ruim. */
const PREVIOUS: HarvestFile = {
  harvestedAt: '2026-11-06T09:00:00.000Z',
  status: 'ok',
  searches: [{ label: 'Bahia', query: 'de ontem', found: 1, discarded: NOTHING_DISCARDED }],
  posts: [
    {
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000/',
      author: 'Publicacao de ontem',
      text: 'vaga de ontem',
      links: [],
      hasJobAction: false,
    },
  ],
};

/**
 * A pagina de mentira: filas de respostas, e um caderno do que foi pedido.
 *
 * E ela que torna a colheita inteira verificavel sem navegador — inclusive os
 * dois casos que mais importam e que ninguem consegue produzir sob demanda no
 * LinkedIn: a sessao caindo no meio e o seletor que mudou.
 */
class FakePostsPage implements PostsPage {
  readonly openedUrls: string[] = [];

  readonly revealedWith: number[] = [];

  readonly askedFor: string[] = [];

  constructor(
    private readonly openings: SearchOpening[] = [],
    private readonly pages: string[] = [],
    private readonly links: Readonly<Record<string, string | undefined>> = {},
  ) {}

  open(url: string): Promise<SearchOpening> {
    this.openedUrls.push(url);

    return Promise.resolve(this.openings.shift() ?? OPENED);
  }

  revealMore(maxScrolls: number): Promise<void> {
    this.revealedWith.push(maxScrolls);

    return Promise.resolve();
  }

  html(): Promise<string> {
    return Promise.resolve(this.pages.shift() ?? EMPTY_PAGE);
  }

  postUrl(cardKey: string): Promise<string | undefined> {
    this.askedFor.push(cardKey);

    return Promise.resolve(this.links[cardKey]);
  }
}

function deps(page: PostsPage, overrides: Partial<HarvestRunnerDeps> = {}): HarvestRunnerDeps {
  return {
    page,
    previous: EMPTY_HARVEST,
    searches: SEARCHES,
    maxScrolls: 3,
    postsPerSearch: 10,
    now: () => NOW,
    pause: () => Promise.resolve(),
    log: () => undefined,
    ...overrides,
  };
}

describe('runHarvest, dia bom', () => {
  it('colhe as duas buscas e carimba a hora da colheita', async () => {
    const page = new FakePostsPage([], [CLASSIC_LAYOUT, EMPTY_PAGE]);

    const harvest = await runHarvest(deps(page));

    expect(harvest.status).toBe('ok');
    expect(harvest.harvestedAt).toBe(NOW.toISOString());
    expect(harvest.searches.map((report) => report.label)).toEqual(['Bahia', 'Remoto nacional']);
  });

  it('abre a busca de publicacoes de cada consulta, com o filtro de 24h', async () => {
    const page = new FakePostsPage();

    await runHarvest(deps(page));

    expect(page.openedUrls[0]).toContain('/search/results/content/');
    expect(page.openedUrls[0]).toContain('datePosted=%22past-24h%22');
    expect(page.openedUrls[0]).toContain('keywords=vaga+desenvolvedor+Salvador+Bahia');
    expect(page.openedUrls[1]).toContain('keywords=vaga+desenvolvedor+react+remoto');
  });

  it('rola a lista com o teto de rolagens configurado', async () => {
    const page = new FakePostsPage();

    await runHarvest(deps(page, { maxScrolls: 5 }));

    expect(page.revealedWith).toEqual([5, 5]);
  });

  it('espera entre as buscas, e nao antes da primeira', async () => {
    const page = new FakePostsPage();
    const pauses: number[] = [];

    await runHarvest(
      deps(page, {
        pause: (ms) => {
          pauses.push(ms);

          return Promise.resolve();
        },
      }),
    );

    expect(pauses).toEqual([PAUSE_BETWEEN_SEARCHES_IN_MS]);
  });

  it('conta na busca o que o parser descartou, por motivo', async () => {
    const page = new FakePostsPage([], [NEW_LAYOUT], {
      'update-card-focus-aaa111': CLASSIC_URLS[0],
      'update-card-focus-eee555': CLASSIC_URLS[1],
    });

    const harvest = await runHarvest(deps(page));

    expect(harvest.searches[0]?.discarded).toEqual({
      promoted: 1,
      openToWork: 1,
      unaddressable: 0,
      withoutContent: 1,
      withoutUrl: 0,
    });
    expect(harvest.searches[0]?.found).toBe(2);
  });
});

describe('runHarvest, do card para a publicacao', () => {
  it('no layout classico monta a URL da urn do card, sem perguntar ao navegador', async () => {
    const page = new FakePostsPage([], [CLASSIC_LAYOUT]);

    const harvest = await runHarvest(deps(page));

    expect(harvest.posts.map((post) => post.url)).toEqual(CLASSIC_URLS);
    expect(page.askedFor).toEqual([]);
  });

  it('no layout novo pergunta ao navegador e canoniza o que ele devolve', async () => {
    const page = new FakePostsPage([], [NEW_LAYOUT], {
      'update-card-focus-aaa111':
        'https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416/?utm=feed',
    });

    const harvest = await runHarvest(deps(page));

    expect(page.askedFor).toEqual(['update-card-focus-aaa111', 'update-card-focus-eee555']);
    expect(harvest.posts.map((post) => post.url)).toEqual([CLASSIC_URLS[0]]);
  });

  /** Sem link nao ha data, e sem data a janela de 72h nao tem o que medir. */
  it('descarta o card cujo link nao tem id reconhecivel, e conta o descarte', async () => {
    const page = new FakePostsPage([], [NEW_LAYOUT], {
      'update-card-focus-aaa111': 'https://www.linkedin.com/feed/',
    });

    const harvest = await runHarvest(deps(page));

    expect(harvest.posts).toEqual([]);
    expect(harvest.searches[0]?.discarded.withoutUrl).toBe(2);
  });

  it('leva o autor, o subtitulo, os links e o botao de candidatura', async () => {
    const page = new FakePostsPage([], [CLASSIC_LAYOUT]);

    const [post] = (await runHarvest(deps(page))).posts;

    expect(post?.author).toBe('João Pereira');
    expect(post?.authorUrl).toBe('https://www.linkedin.com/in/joao-pereira');
    expect(post?.headline).toBe('Tech Recruiter');
    expect(post?.links).toEqual([]);
    expect(post?.hasJobAction).toBe(false);
  });

  it('omite autorUrl e subtitulo quando o card nao os tem', async () => {
    const page = new FakePostsPage([], [CLASSIC_LAYOUT]);

    const post = (await runHarvest(deps(page))).posts[2];

    expect(post?.author).toBe('Maria Oliveira');
    expect(post).not.toHaveProperty('authorUrl');
    expect(post?.headline).toBeUndefined();
  });

  it('a mesma publicacao nas duas buscas rende uma linha, e nao duas', async () => {
    const page = new FakePostsPage([], [CLASSIC_LAYOUT, CLASSIC_LAYOUT]);

    const harvest = await runHarvest(deps(page));

    expect(harvest.posts).toHaveLength(3);
    expect(harvest.searches.map((report) => report.found)).toEqual([3, 3]);
  });

  it('para no teto de publicacoes por busca', async () => {
    const page = new FakePostsPage([], [CLASSIC_LAYOUT]);

    const harvest = await runHarvest(deps(page, { postsPerSearch: 2 }));

    expect(harvest.posts.map((post) => post.url)).toEqual(CLASSIC_URLS.slice(0, 2));
  });
});

describe('runHarvest, dia ruim', () => {
  it('pagina sem publicacao nenhuma devolve colheita vazia, e nao falha', async () => {
    const page = new FakePostsPage();

    const harvest = await runHarvest(deps(page));

    expect(harvest.status).toBe('ok');
    expect(harvest.posts).toEqual([]);
    expect(harvest.searches.every((report) => report.found === 0)).toBe(true);
  });

  it('sessao caida para tudo e preserva a colheita anterior', async () => {
    const page = new FakePostsPage([
      { outcome: 'signed-out', url: 'https://www.linkedin.com/login' },
    ]);

    const harvest = await runHarvest(deps(page, { previous: PREVIOUS }));

    expect(harvest.status).toBe('session-lost');
    expect(harvest.posts).toEqual(PREVIOUS.posts);
    expect(page.openedUrls).toHaveLength(1);
  });

  /** O carimbo antigo e o que mantem a idade da colheita honesta no painel. */
  it('sessao caida nao carimba a hora de agora', async () => {
    const page = new FakePostsPage([
      { outcome: 'signed-out', url: 'https://www.linkedin.com/login' },
    ]);

    const harvest = await runHarvest(deps(page, { previous: PREVIOUS }));

    expect(harvest.harvestedAt).toBe(PREVIOUS.harvestedAt);
  });

  it('uma busca que nao abre degrada a colheita, mas a outra vale', async () => {
    const page = new FakePostsPage(
      [{ outcome: 'failed', reason: 'timeout de 30000ms' }],
      [CLASSIC_LAYOUT],
    );

    const harvest = await runHarvest(deps(page));

    expect(harvest.status).toBe('degraded');
    expect(harvest.harvestedAt).toBe(NOW.toISOString());
    expect(harvest.posts).toHaveLength(3);
  });

  it('a busca que nao abriu entra no relatorio com zero, e nao desaparece dele', async () => {
    const page = new FakePostsPage([{ outcome: 'failed', reason: 'timeout' }], [CLASSIC_LAYOUT]);

    const harvest = await runHarvest(deps(page));

    expect(harvest.searches[0]).toEqual({
      label: 'Bahia',
      query: 'vaga desenvolvedor Salvador Bahia',
      found: 0,
      discarded: NOTHING_DISCARDED,
    });
  });

  it('nenhuma busca abrindo preserva as publicacoes de ontem', async () => {
    const page = new FakePostsPage([
      { outcome: 'failed', reason: 'timeout' },
      { outcome: 'failed', reason: 'timeout' },
    ]);

    const harvest = await runHarvest(deps(page, { previous: PREVIOUS }));

    expect(harvest.status).toBe('degraded');
    expect(harvest.posts).toEqual(PREVIOUS.posts);
    expect(harvest.harvestedAt).toBe(PREVIOUS.harvestedAt);
    expect(harvest.searches.map((report) => report.label)).toEqual(['Bahia', 'Remoto nacional']);
  });

  it('conta no diario o que falhou e o que rendeu', async () => {
    const page = new FakePostsPage([
      { outcome: 'signed-out', url: 'https://www.linkedin.com/checkpoint/challenge' },
    ]);
    const lines: string[] = [];

    await runHarvest(deps(page, { log: (message) => lines.push(message) }));

    expect(lines[0]).toContain('Sessao caida');
    expect(lines[0]).toContain('/checkpoint/challenge');
  });

  it('diz quantas publicacoes cada busca rendeu', async () => {
    const page = new FakePostsPage([], [CLASSIC_LAYOUT]);
    const lines: string[] = [];

    await runHarvest(deps(page, { log: (message) => lines.push(message) }));

    expect(lines[0]).toContain('[Bahia]');
    expect(lines[0]).toContain('3 publicacao(oes)');
  });

  it('busca que nao abriu diz o motivo no diario', async () => {
    const page = new FakePostsPage([{ outcome: 'failed', reason: 'timeout de 30000ms' }]);
    const lines: string[] = [];

    await runHarvest(deps(page, { log: (message) => lines.push(message) }));

    expect(lines[0]).toContain('[Bahia] nao abriu: timeout de 30000ms');
  });
});
