import { beforeEach, describe, expect, it } from 'vitest';

import {
  LINKEDIN_POSTS_QUERY,
  LINKEDIN_POSTS_RECENCY,
  LINKEDIN_POSTS_RESULT_LIMIT,
  SERPER_ENDPOINT,
  LinkedinPostsScraperProvider,
} from '@/infra/scrapers/linkedin-posts-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readJsonFixture,
} from '../../../test/factories/fake-http-client';

const FIXTURE = readJsonFixture<unknown>('serp-linkedin-posts.json');

const CONFIG = { endpoint: SERPER_ENDPOINT, apiKey: 'chave-de-teste' };

describe('LinkedinPostsScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: LinkedinPostsScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => FIXTURE);
    provider = new LinkedinPostsScraperProvider(http, CONFIG, 1);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('linkedin-posts');
    expect(provider.label).toBe('Publicacoes do LinkedIn');
  });

  describe('consulta ao buscador', () => {
    it('limita a busca ao caminho de publicacoes', async () => {
      await provider.scrape();

      expect(LINKEDIN_POSTS_QUERY).toContain('site:linkedin.com/posts');
    });

    it('procura marcador de anuncio junto da stack', async () => {
      expect(LINKEDIN_POSTS_QUERY).toContain('"contratando"');
      expect(LINKEDIN_POSTS_QUERY).toContain('"react"');
    });

    it('chama o endpoint do Serper', async () => {
      await provider.scrape();

      expect(http.requestedUrls).toEqual(['https://google.serper.dev/search']);
    });

    it('manda a consulta no corpo, que e o que o Serper espera', async () => {
      await provider.scrape();

      expect(http.requests[0]?.body).toMatchObject({
        q: LINKEDIN_POSTS_QUERY,
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
      const semChave = new LinkedinPostsScraperProvider(http, {
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
        await new LinkedinPostsScraperProvider(http).scrape();

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
        await new LinkedinPostsScraperProvider(http).scrape();

        expect(http.requestedUrls[0]).toBe('https://exemplo.test/search');
      } finally {
        process.env.SERP_ENDPOINT = previousEndpoint;
        process.env.SERP_API_KEY = previousKey;
      }
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
        CONFIG,
        1,
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
        CONFIG,
        1,
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
        CONFIG,
        1,
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
        CONFIG,
        1,
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
        CONFIG,
        1,
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
        CONFIG,
        1,
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
        new LinkedinPostsScraperProvider(new FakeHttpClient(() => body), CONFIG, 1).scrape(),
      ).resolves.toEqual([]);
    });

    it('devolve lista vazia quando a resposta nao tem lista de resultados', async () => {
      const estranho = new LinkedinPostsScraperProvider(
        new FakeHttpClient(() => ({ erro: 'cota excedida' })),
        CONFIG,
        1,
      );

      await expect(estranho.scrape()).resolves.toEqual([]);
    });

    it('devolve lista vazia quando o buscador esta fora do ar', async () => {
      const fora = new LinkedinPostsScraperProvider(failingHttpClient('429'), CONFIG, 1);

      await expect(fora.scrape()).resolves.toEqual([]);
    });
  });
});
