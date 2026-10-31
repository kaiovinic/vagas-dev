import { beforeEach, describe, expect, it } from 'vitest';

import {
  LINKEDIN_POSTS_MIN_INTERVAL_HOURS,
  LINKEDIN_POSTS_QUERIES_PER_RUN,
  LINKEDIN_POSTS_RECENCY,
  LINKEDIN_POSTS_SEARCHES,
  LINKEDIN_POSTS_RESULT_LIMIT,
  SERPER_ENDPOINT,
  LinkedinPostsScraperProvider,
} from '@/infra/scrapers/linkedin-posts-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readJsonFixture,
} from '../../../test/factories/fake-http-client';
import { StubSourceLastRunReader } from '../../../test/factories/doubles';

const FIXTURE = readJsonFixture<unknown>('serp-linkedin-posts.json');

const CONFIG = { endpoint: SERPER_ENDPOINT, apiKey: 'chave-de-teste' };

/** Uma busca, uma pagina: os casos de parse nao precisam de mais. */
const UMA_BUSCA = [{ label: 'teste', query: 'site:linkedin.com/posts vaga', pages: 1 }];

describe('LinkedinPostsScraperProvider', () => {
  let http: FakeHttpClient;
  let lastRun: StubSourceLastRunReader;
  let provider: LinkedinPostsScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => FIXTURE);
    lastRun = new StubSourceLastRunReader();
    provider = new LinkedinPostsScraperProvider(http, lastRun, CONFIG, UMA_BUSCA);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('linkedin-posts');
    expect(provider.label).toBe('Publicacoes do LinkedIn');
  });

  describe('consulta ao buscador', () => {
    it('limita toda busca ao caminho de publicacoes', () => {
      for (const search of LINKEDIN_POSTS_SEARCHES) {
        expect(search.query).toContain('site:linkedin.com/posts');
      }
    });

    it('separa a busca nacional da regional', () => {
      expect(LINKEDIN_POSTS_SEARCHES.map((search) => search.label)).toEqual([
        'Remoto nacional',
        'Salvador e RMS',
      ]);
    });

    it('a busca regional cita Salvador e a regiao metropolitana', () => {
      const regional = LINKEDIN_POSTS_SEARCHES.find((s) => s.label === 'Salvador e RMS');

      expect(regional?.query).toContain('"salvador"');
      expect(regional?.query).toContain('"lauro de freitas"');
      expect(regional?.query).toContain('"camaçari"');
    });

    it('a busca nacional exige modalidade remota', () => {
      const nacional = LINKEDIN_POSTS_SEARCHES.find((s) => s.label === 'Remoto nacional');

      expect(nacional?.query).toContain('"remoto"');
      expect(nacional?.query).toContain('"home office"');
    });

    it('consulta cada busca em cada pagina', async () => {
      const duas = [
        { label: 'a', query: 'consulta-a', pages: 2 },
        { label: 'b', query: 'consulta-b', pages: 1 },
      ];

      await new LinkedinPostsScraperProvider(http, lastRun, CONFIG, duas).scrape();

      expect(http.requests.map((r) => (r.body as { q: string; page: number }))).toEqual([
        expect.objectContaining({ q: 'consulta-a', page: 1 }),
        expect.objectContaining({ q: 'consulta-a', page: 2 }),
        expect.objectContaining({ q: 'consulta-b', page: 1 }),
      ]);
    });

    it('chama o endpoint do Serper', async () => {
      await provider.scrape();

      expect(http.requestedUrls).toEqual(['https://google.serper.dev/search']);
    });

    it('manda a consulta no corpo, que e o que o Serper espera', async () => {
      await provider.scrape();

      expect(http.requests[0]?.body).toMatchObject({
        q: UMA_BUSCA[0]?.query,
        tbs: LINKEDIN_POSTS_RECENCY,
        num: LINKEDIN_POSTS_RESULT_LIMIT,
        gl: 'br',
      });
    });

    it('recorta nos ultimos 3 dias, a janela do radar', () => {
      expect(LINKEDIN_POSTS_RECENCY).toBe('qdr:d3');
    });

    it('autentica pelo cabecalho X-API-KEY', async () => {
      await provider.scrape();

      const headers = http.requests[0]?.options?.headers ?? {};

      expect(headers['X-API-KEY']).toBe('chave-de-teste');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('vira no-op silencioso sem configuracao', async () => {
      const semChave = new LinkedinPostsScraperProvider(http, lastRun, {
        endpoint: SERPER_ENDPOINT,
        apiKey: '',
      });

      await expect(semChave.scrape()).resolves.toEqual([]);
      expect(http.requestedUrls).toEqual([]);
    });

    it('le a chave do ambiente e usa o Serper por padrao', async () => {
      const previousEndpoint = process.env.SERP_ENDPOINT;
      const previousKey = process.env.SERP_API_KEY;
      delete process.env.SERP_ENDPOINT;
      process.env.SERP_API_KEY = 'do-ambiente';

      try {
        await new LinkedinPostsScraperProvider(http, lastRun).scrape();

        expect(http.requestedUrls[0]).toBe(SERPER_ENDPOINT);
        expect(http.requests[0]?.options?.headers?.['X-API-KEY']).toBe('do-ambiente');
      } finally {
        process.env.SERP_ENDPOINT = previousEndpoint;
        process.env.SERP_API_KEY = previousKey;
      }
    });

    it('permite apontar para outro fornecedor pelo ambiente', async () => {
      const previousEndpoint = process.env.SERP_ENDPOINT;
      const previousKey = process.env.SERP_API_KEY;
      process.env.SERP_ENDPOINT = 'https://exemplo.test/search';
      process.env.SERP_API_KEY = 'do-ambiente';

      try {
        await new LinkedinPostsScraperProvider(http, lastRun).scrape();

        expect(http.requestedUrls[0]).toBe('https://exemplo.test/search');
      } finally {
        process.env.SERP_ENDPOINT = previousEndpoint;
        process.env.SERP_API_KEY = previousKey;
      }
    });
  });

  describe('intervalo entre execucoes', () => {
    const AGORA = new Date('2026-10-31T13:00:00.000Z');

    /** Relogio fixo: o intervalo e medido contra o que o banco registrou. */
    function comIntervalo(): LinkedinPostsScraperProvider {
      return new LinkedinPostsScraperProvider(
        http,
        lastRun,
        CONFIG,
        UMA_BUSCA,
        () => AGORA,
        4,
      );
    }

    function horasAtras(horas: number): Date {
      return new Date(AGORA.getTime() - horas * 3_600_000);
    }

    it('espaca as buscas em 4 horas, para a cota durar', () => {
      expect(LINKEDIN_POSTS_MIN_INTERVAL_HOURS).toBe(4);
    });

    it('esta na hora quando a fonte nunca rodou', async () => {
      lastRun.lastRunAt = null;

      await expect(comIntervalo().isDue(AGORA)).resolves.toBe(true);
    });

    it('pergunta pela propria fonte', async () => {
      await comIntervalo().isDue(AGORA);

      expect(lastRun.asked).toEqual(['linkedin-posts']);
    });

    // A captura geral roda a cada 2h; esta e a execucao que deve ser pulada.
    it('nao esta na hora dentro do intervalo', async () => {
      lastRun.lastRunAt = horasAtras(2);

      await expect(comIntervalo().isDue(AGORA)).resolves.toBe(false);
    });

    it('esta na hora quando o intervalo fecha exatamente', async () => {
      lastRun.lastRunAt = horasAtras(4);

      await expect(comIntervalo().isDue(AGORA)).resolves.toBe(true);
    });

    it('esta na hora depois do intervalo', async () => {
      lastRun.lastRunAt = horasAtras(13);

      await expect(comIntervalo().isDue(AGORA)).resolves.toBe(true);
    });

    /**
     * O ponto da mudanca: antes o intervalo vivia num campo em memoria, e todo
     * restart da API o zerava — a primeira captura seguinte gastava credito por
     * mais recente que tivesse sido a busca anterior.
     */
    it('respeita o intervalo mesmo em uma instancia recem-criada', async () => {
      lastRun.lastRunAt = horasAtras(1);

      const recemSubido = comIntervalo();

      await expect(recemSubido.isDue(AGORA)).resolves.toBe(false);
      await expect(recemSubido.scrape()).resolves.toEqual([]);
      expect(http.requestedUrls).toEqual([]);
    });

    it('busca quando chamado direto e esta na hora', async () => {
      lastRun.lastRunAt = horasAtras(5);

      await comIntervalo().scrape();

      expect(http.requestedUrls).toHaveLength(1);
    });

    it('nunca esta na hora sem chave configurada', async () => {
      const semChave = new LinkedinPostsScraperProvider(
        http,
        lastRun,
        { endpoint: SERPER_ENDPOINT, apiKey: '' },
        UMA_BUSCA,
      );

      // Sem chave nao ha busca a fazer, e perguntar ao banco seria em vao.
      await expect(semChave.isDue(AGORA)).resolves.toBe(false);
      expect(lastRun.asked).toEqual([]);
    });

    it('gasta tres creditos por execucao', () => {
      // Uma pagina da busca nacional e duas da regional.
      expect(LINKEDIN_POSTS_QUERIES_PER_RUN).toBe(3);
    });
  });

  describe('leitura dos resultados', () => {
    it('monta a publicacao no formato do DevRadar', async () => {
      const posts = await provider.scrape();

      expect(posts[0]).toMatchObject({
        company: 'Mayaramoroni',
        recruiterName: 'Mayaramoroni',
        source: 'linkedin-posts',
        url: 'https://www.linkedin.com/posts/mayaramoroni_estamos-buscando-uma-desenvolvedora-share-7521262024920764416-91vX',
        publishedAtSource: 'SOURCE',
      });
    });

    it('tira a data do snowflake da url, nao do buscador', async () => {
      const posts = await provider.scrape();

      // O resultado do buscador nao traz data; o id do post traz, ao minuto.
      expect(posts[0]?.publishedAt?.toISOString()).toBe('2026-10-28T17:30:05.032Z');
    });

    it('usa o texto do post como titulo, nao o rotulo do buscador', async () => {
      const posts = await provider.scrape();

      // O buscador preenche o titulo com metadado ("Publicacao de Fulano");
      // quem carrega o anuncio e o snippet.
      expect(posts[0]?.title).toContain('Fullstack SR');
      expect(posts[0]?.title).not.toContain('on LinkedIn');
    });

    it('cai para o titulo do buscador, limpo, quando nao ha snippet', async () => {
      const semSnippet = {
        organic: [
          {
            title: 'Acme on LinkedIn: Vaga de Dev React | LinkedIn',
            link: 'https://www.linkedin.com/posts/acme_vaga-share-7521262024920764416-91vX',
          },
        ],
      };

      const posts = await new LinkedinPostsScraperProvider(
        new FakeHttpClient(() => semSnippet),
        lastRun,
        CONFIG,
        UMA_BUSCA,
      ).scrape();

      expect(posts[0]?.title).toBe('Vaga de Dev React');
    });

    it('trunca texto longo de post', async () => {
      const longo = {
        organic: [
          {
            link: 'https://www.linkedin.com/posts/acme_vaga-share-7521262024920764416-91vX',
            snippet: 'Vaga '.repeat(60),
          },
        ],
      };

      const posts = await new LinkedinPostsScraperProvider(
        new FakeHttpClient(() => longo),
        lastRun,
        CONFIG,
        UMA_BUSCA,
      ).scrape();

      expect(posts[0]?.title.length).toBeLessThanOrEqual(140);
      expect(posts[0]?.title).toContain('…');
    });

    it('guarda o snippet como descricao, que e o texto do post', async () => {
      const posts = await provider.scrape();

      expect(posts[0]?.description).toContain('Fullstack SR');
    });

    it('descarta resultado que nao e publicacao', async () => {
      const posts = await provider.scrape();

      // A fixture tem um perfil (/in/) entre os resultados.
      expect(posts.every((post) => post.url.includes('/posts/'))).toBe(true);
    });

    it('nao filtra post ruim aqui: quem julga conteudo e o motor de regras', async () => {
      const posts = await provider.scrape();

      // A divulgacao de grupo e a reflexao de carreira passam pelo coletor e
      // sao reprovadas depois, pelas regras de publicacao social.
      expect(posts).toHaveLength(4);
    });

    it('deduplica a mesma publicacao repetida nos resultados', async () => {
      const repetido = {
        organic_results: [
          {
            title: 'Vaga React',
            link: 'https://www.linkedin.com/posts/acme_vaga-share-7521262024920764416-91vX',
            snippet: 'Estamos contratando',
          },
          {
            title: 'Vaga React de novo',
            link: 'https://www.linkedin.com/posts/acme_vaga-share-7521262024920764416-91vX?utm_source=x',
            snippet: 'Estamos contratando',
          },
        ],
      };

      const posts = await new LinkedinPostsScraperProvider(
        new FakeHttpClient(() => repetido),
        lastRun,
        CONFIG,
        UMA_BUSCA,
      ).scrape();

      expect(posts).toHaveLength(1);
    });
  });

  describe('formatos de resposta', () => {
    it.each([
      ['organic_results, do SerpApi', 'organic_results'],
      ['organic, do Serper', 'organic'],
      ['results, generico', 'results'],
    ])('aceita %s', async (_caso, key) => {
      const body = {
        [key]: [
          {
            title: 'Vaga React',
            link: 'https://www.linkedin.com/posts/acme_vaga-share-7521262024920764416-91vX',
            snippet: 'Estamos contratando',
          },
        ],
      };

      const posts = await new LinkedinPostsScraperProvider(
        new FakeHttpClient(() => body),
        lastRun,
        CONFIG,
        UMA_BUSCA,
      ).scrape();

      expect(posts).toHaveLength(1);
    });

    it('usa `url` quando o fornecedor nao manda `link`', async () => {
      const body = {
        organic: [
          {
            title: 'Vaga React',
            url: 'https://www.linkedin.com/posts/acme_vaga-share-7521262024920764416-91vX',
            description: 'Estamos contratando',
          },
        ],
      };

      const posts = await new LinkedinPostsScraperProvider(
        new FakeHttpClient(() => body),
        lastRun,
        CONFIG,
        UMA_BUSCA,
      ).scrape();

      expect(posts[0]?.description).toBe('Estamos contratando');
    });

    it('cai para o snippet quando nao ha titulo', async () => {
      const body = {
        organic: [
          {
            link: 'https://www.linkedin.com/posts/acme_vaga-share-7521262024920764416-91vX',
            snippet: 'Estamos contratando pessoa desenvolvedora React',
          },
        ],
      };

      const posts = await new LinkedinPostsScraperProvider(
        new FakeHttpClient(() => body),
        lastRun,
        CONFIG,
        UMA_BUSCA,
      ).scrape();

      expect(posts[0]?.title).toBe('Estamos contratando pessoa desenvolvedora React');
    });

    it('descarta resultado sem titulo nem snippet', async () => {
      const body = {
        organic: [
          { link: 'https://www.linkedin.com/posts/acme_vaga-share-7521262024920764416-91vX' },
        ],
      };

      await expect(
        new LinkedinPostsScraperProvider(new FakeHttpClient(() => body), lastRun, CONFIG, UMA_BUSCA).scrape(),
      ).resolves.toEqual([]);
    });

    it('devolve lista vazia quando a resposta nao tem lista de resultados', async () => {
      const estranho = new LinkedinPostsScraperProvider(
        new FakeHttpClient(() => ({ erro: 'cota excedida' })),
        lastRun,
        CONFIG,
        UMA_BUSCA,
      );

      await expect(estranho.scrape()).resolves.toEqual([]);
    });

    it('devolve lista vazia quando o buscador esta fora do ar', async () => {
      const fora = new LinkedinPostsScraperProvider(failingHttpClient('429'), lastRun, CONFIG, UMA_BUSCA);

      await expect(fora.scrape()).resolves.toEqual([]);
    });
  });
});
