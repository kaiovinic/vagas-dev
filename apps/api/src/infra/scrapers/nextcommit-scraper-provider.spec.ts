import { beforeEach, describe, expect, it } from 'vitest';

import {
  NEXTCOMMIT_DEFAULT_AREAS,
  NEXTCOMMIT_PAGES,
  NEXTCOMMIT_REQUEST_DELAY_IN_MS,
  NextCommitScraperProvider,
} from '@/infra/scrapers/nextcommit-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readFixture,
  readJsonFixture,
} from '../../../test/factories/fake-http-client';

const FIXTURE = readFixture('nextcommit.html');
const JOBICY_FIXTURE = readFixture('jobicy-job.html');
const GREENHOUSE_FIXTURE = readJsonFixture<unknown>('greenhouse-job.json');

describe('NextCommitScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: NextCommitScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => FIXTURE);
    provider = new NextCommitScraperProvider(http, ['frontend'], 1);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('nextcommit');
    expect(provider.label).toBe('Next Commit');
  });

  describe('requisicao', () => {
    it('consulta cada area, paginada', async () => {
      await new NextCommitScraperProvider(http, ['frontend', 'fullstack'], 2).scrape();

      expect(http.requestedUrls).toEqual([
        'https://www.nextcommit.dev/vagas?area=frontend&pagina=1',
        'https://www.nextcommit.dev/vagas?area=frontend&pagina=2',
        'https://www.nextcommit.dev/vagas?area=fullstack&pagina=1',
        'https://www.nextcommit.dev/vagas?area=fullstack&pagina=2',
      ]);
    });

    it('cobre as areas que batem com a stack monitorada', () => {
      expect(NEXTCOMMIT_DEFAULT_AREAS).toEqual(['frontend', 'fullstack', 'backend']);
    });

    it('usa o parametro em portugues, o unico que o site respeita', async () => {
      await provider.scrape();

      // `?page=2` e aceito e ignorado: devolve a primeira pagina de novo.
      expect(http.requestedUrls[0]).toContain('pagina=');
      expect(http.requestedUrls[0]).not.toContain('page=');
    });

    it('busca mais de uma pagina por area, como margem', () => {
      // A pagina 1 ja traz o mais novo; a 2 e margem para dia de volume alto.
      expect(NEXTCOMMIT_PAGES).toBeGreaterThanOrEqual(2);
    });
  });

  describe('mapeamento do card', () => {
    it('monta a vaga no formato do DevRadar', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]).toMatchObject({
        title: '[Job-32363] Senior Frontend Developer (React), Brazil',
        company: 'CI&T',
        source: 'nextcommit',
        location: 'Remoto · Remoto (Brazil)',
        workModel: 'REMOTE',
        publishedAtSource: 'SOURCE',
      });
    });

    it('aponta para o anuncio original, nao para o agregador', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]?.url).toContain('himalayas.app');
      expect(jobs[0]?.url).not.toContain('nextcommit.dev');
    });

    it('descarta a query de rastreamento do link', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]?.url).not.toContain('utm_source');
    });

    it('le a data do atributo da tag time, com hora cheia', async () => {
      const jobs = await provider.scrape();

      // O card exibe so "27/10/2026"; o atributo traz o instante completo.
      expect(jobs[0]?.publishedAt?.toISOString()).toBe('2026-10-28T00:59:20.000Z');
    });

    it('le as tecnologias declaradas, sem o rotulo de acessibilidade', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]?.tags).toEqual(['React']);
    });

    it('aguenta card sem tecnologia declarada', async () => {
      const jobs = await provider.scrape();
      const semStack = jobs.find((job) => job.company === 'GoFasti');

      expect(semStack?.tags).toEqual([]);
    });

    it('decodifica entidade html do nome da empresa', async () => {
      const jobs = await provider.scrape();

      // No markup vem como `CI&amp;T`.
      expect(jobs.some((job) => job.company === 'CI&T')).toBe(true);
    });
  });

  describe('empresa corrompida na origem', () => {
    it('nao importa jornada de trabalho como nome de empresa', async () => {
      const jobs = await provider.scrape();

      // O Next Commit tem o mesmo defeito de parse que o DevRadar ja corrigiu
      // no coletor do GitHub: grava "4 dias / 32h" no campo da empresa.
      expect(jobs.every((job) => !job.company.includes('4 dias'))).toBe(true);
    });

    it('recupera a empresa do titulo quando o campo vem corrompido', async () => {
      const jobs = await provider.scrape();
      const weatherwise = jobs.find((job) => job.title.includes('Product Engineer'));

      expect(weatherwise?.company).toBe('WeatherWise');
    });

    it('descarta o card quando nem o titulo salva a empresa', async () => {
      const quebrado = FIXTURE.replace(
        'Senior Front-end / Product Engineer na WeatherWise',
        'Engenheiro de Software',
      );
      const jobs = await new NextCommitScraperProvider(
        new FakeHttpClient(() => quebrado),
        ['frontend'],
        1,
      ).scrape();

      expect(jobs.some((job) => job.title === 'Engenheiro de Software')).toBe(false);
    });
  });

  describe('contrato do coletor', () => {
    it('le todos os cards da pagina', async () => {
      const jobs = await provider.scrape();

      // A fixture tem 5 cards; um e descartado por empresa irrecuperavel? Nao:
      // o titulo recupera, entao os 5 entram.
      expect(jobs).toHaveLength(5);
    });

    it('remove a mesma vaga repetida entre areas', async () => {
      const jobs = await new NextCommitScraperProvider(http, ['frontend', 'fullstack'], 1).scrape();

      expect(jobs).toHaveLength(5);
    });

    it('devolve lista vazia quando a fonte esta fora do ar', async () => {
      const fora = new NextCommitScraperProvider(failingHttpClient(), ['frontend'], 1);

      await expect(fora.scrape()).resolves.toEqual([]);
    });

    it('devolve lista vazia quando o layout muda e nao ha mais card', async () => {
      const vazio = new NextCommitScraperProvider(
        new FakeHttpClient(() => '<html><body><p>sem vagas</p></body></html>'),
        ['frontend'],
        1,
      );

      await expect(vazio.scrape()).resolves.toEqual([]);
    });

    it('descarta card sem link de candidatura', async () => {
      const semLink = FIXTURE.replace(/href="https:\/\/himalayas[^"]*"/g, 'href=""');
      const jobs = await new NextCommitScraperProvider(
        new FakeHttpClient(() => semLink),
        ['frontend'],
        1,
      ).scrape();

      expect(jobs.every((job) => job.url.length > 0)).toBe(true);
    });
  });
  describe('descricao na origem', () => {
    const JOBICY = 'https://jobicy.com/jobs/157106-senior-backend-engineer-13';
    const GREENHOUSE = 'https://job-boards.greenhouse.io/stone/jobs/8037007003';
    const HIMALAYAS =
      'https://himalayas.app/companies/keyrus/jobs/python-developer-mid-level?utm_source=api';
    const ISSUE = 'https://github.com/frontendbr/vagas/issues/8572';

    /** Quanto o coletor pediu para esperar, em vez de esperar de verdade. */
    let waits: number[];

    function makeFetcher(respond: (url: string) => unknown): NextCommitScraperProvider {
      return new NextCommitScraperProvider(new FakeHttpClient(respond), ['frontend'], 1, async (
        ms,
      ) => {
        waits.push(ms);
      });
    }

    beforeEach(() => {
      waits = [];
    });

    it('le o JSON-LD da vaga quando a origem publica um', async () => {
      const fetcher = makeFetcher(() => JOBICY_FIXTURE);

      const texto = await fetcher.fetchDescriptionFor(JOBICY);

      expect(texto).toContain('5+ anos com Python');
    });

    it('pede a propria pagina da origem, nao a do agregador', async () => {
      const client = new FakeHttpClient(() => JOBICY_FIXTURE);

      await new NextCommitScraperProvider(client, ['frontend'], 1, async () => {}).fetchDescriptionFor(
        JOBICY,
      );

      expect(client.requestedUrls).toEqual([JOBICY]);
    });

    it('usa a API aberta do Greenhouse, que nao publica JSON-LD na pagina', async () => {
      const client = new FakeHttpClient(() => GREENHOUSE_FIXTURE);
      const fetcher = new NextCommitScraperProvider(client, ['frontend'], 1, async () => {});

      const texto = await fetcher.fetchDescriptionFor(GREENHOUSE);

      expect(client.requestedUrls).toEqual([
        'https://boards-api.greenhouse.io/v1/boards/stone/jobs/8037007003',
      ]);
      expect(texto).toContain('Sobre a Stone:');
      expect(texto).toContain('Experiência com React e TypeScript');
    });

    it('desescapa a marcacao que a API do Greenhouse devolve', async () => {
      const fetcher = makeFetcher(() => GREENHOUSE_FIXTURE);

      const texto = await fetcher.fetchDescriptionFor(GREENHOUSE);

      expect(texto).not.toContain('&lt;');
      expect(texto).not.toContain('<p>');
    });

    it('devolve vazio quando a vaga do Greenhouse vem sem conteudo', async () => {
      const fetcher = makeFetcher(() => ({ title: 'Vaga' }));

      await expect(fetcher.fetchDescriptionFor(GREENHOUSE)).resolves.toBe('');
    });

    it('cai no JSON-LD quando a url do Greenhouse nao e de uma vaga', async () => {
      const client = new FakeHttpClient(() => JOBICY_FIXTURE);
      const quadro = 'https://job-boards.greenhouse.io/stone';
      const fetcher = new NextCommitScraperProvider(client, ['frontend'], 1, async () => {});

      await fetcher.fetchDescriptionFor(quadro);

      expect(client.requestedUrls).toEqual([quadro]);
    });

    it('nao gasta requisicao com origem que serve desafio de bot', async () => {
      const client = new FakeHttpClient(() => JOBICY_FIXTURE);
      const fetcher = new NextCommitScraperProvider(client, ['frontend'], 1, async (ms) => {
        waits.push(ms);
      });

      await expect(fetcher.fetchDescriptionFor(HIMALAYAS)).resolves.toBe('');
      expect(client.requestedUrls).toEqual([]);
      expect(waits).toEqual([]);
    });

    it('nao busca a issue do GitHub, que o coletor do GitHub ja traz inteira', async () => {
      const client = new FakeHttpClient(() => JOBICY_FIXTURE);
      const fetcher = new NextCommitScraperProvider(client, ['frontend'], 1, async () => {});

      await expect(fetcher.fetchDescriptionFor(ISSUE)).resolves.toBe('');
      expect(client.requestedUrls).toEqual([]);
    });

    it('espera antes de pedir, para nao somar rajada a origem', async () => {
      const fetcher = makeFetcher(() => JOBICY_FIXTURE);

      await fetcher.fetchDescriptionFor(JOBICY);

      expect(waits).toEqual([NEXTCOMMIT_REQUEST_DELAY_IN_MS]);
    });

    it('devolve vazio sem lancar quando a origem falha', async () => {
      const quebrado = new NextCommitScraperProvider(
        failingHttpClient('403 Forbidden'),
        ['frontend'],
        1,
        async () => {},
      );

      await expect(quebrado.fetchDescriptionFor(JOBICY)).resolves.toBe('');
    });

    it('devolve vazio para url que nao da nem para interpretar', async () => {
      const client = new FakeHttpClient(() => JOBICY_FIXTURE);
      const fetcher = new NextCommitScraperProvider(client, ['frontend'], 1, async () => {});

      await expect(fetcher.fetchDescriptionFor('vaga-sem-esquema')).resolves.toBe('');
      expect(client.requestedUrls).toEqual([]);
    });

    it('devolve vazio quando a origem nao publica JSON-LD de vaga', async () => {
      const fetcher = makeFetcher(() => '<html><body><h1>Vaga</h1></body></html>');

      await expect(fetcher.fetchDescriptionFor(JOBICY)).resolves.toBe('');
    });
  });
});
