import { beforeEach, describe, expect, it } from 'vitest';

import {
  NEXTCOMMIT_DEFAULT_TRACKS,
  NextCommitScraperProvider,
} from '@/infra/scrapers/nextcommit-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readFixture,
} from '../../../test/factories/fake-http-client';

const FIXTURE = readFixture('nextcommit.html');

describe('NextCommitScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: NextCommitScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => FIXTURE);
    provider = new NextCommitScraperProvider(http, ['front-end']);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('nextcommit');
    expect(provider.label).toBe('Next Commit');
  });

  describe('requisicao', () => {
    it('consulta a pagina de cada trilha configurada', async () => {
      await new NextCommitScraperProvider(http, ['front-end', 'full-stack']).scrape();

      expect(http.requestedUrls).toEqual([
        'https://www.nextcommit.dev/vagas/front-end',
        'https://www.nextcommit.dev/vagas/full-stack',
      ]);
    });

    it('cobre as trilhas que batem com a stack monitorada', () => {
      expect(NEXTCOMMIT_DEFAULT_TRACKS).toEqual(['front-end', 'full-stack', 'back-end']);
    });

    it('nao pagina: o servidor devolve sempre os mesmos 24 da primeira pagina', async () => {
      await provider.scrape();

      expect(http.requestedUrls.every((url) => !url.includes('page='))).toBe(true);
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
        ['front-end'],
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

    it('remove a mesma vaga repetida entre trilhas', async () => {
      const jobs = await new NextCommitScraperProvider(http, [
        'front-end',
        'full-stack',
      ]).scrape();

      expect(jobs).toHaveLength(5);
    });

    it('devolve lista vazia quando a fonte esta fora do ar', async () => {
      const fora = new NextCommitScraperProvider(failingHttpClient(), ['front-end']);

      await expect(fora.scrape()).resolves.toEqual([]);
    });

    it('devolve lista vazia quando o layout muda e nao ha mais card', async () => {
      const vazio = new NextCommitScraperProvider(
        new FakeHttpClient(() => '<html><body><p>sem vagas</p></body></html>'),
        ['front-end'],
      );

      await expect(vazio.scrape()).resolves.toEqual([]);
    });

    it('descarta card sem link de candidatura', async () => {
      const semLink = FIXTURE.replace(/href="https:\/\/himalayas[^"]*"/g, 'href=""');
      const jobs = await new NextCommitScraperProvider(
        new FakeHttpClient(() => semLink),
        ['front-end'],
      ).scrape();

      expect(jobs.every((job) => job.url.length > 0)).toBe(true);
    });
  });
});
