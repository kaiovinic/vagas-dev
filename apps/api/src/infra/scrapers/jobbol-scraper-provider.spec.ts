import { beforeEach, describe, expect, it } from 'vitest';

import {
  JOBBOL_DEFAULT_CITIES,
  JobbolScraperProvider,
} from '@/infra/scrapers/jobbol-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readFixture,
} from '../../../test/factories/fake-http-client';

const FIXTURE = readFixture('jobbol.html');

/** A fixture foi capturada em 28/10/2026, por volta das 14h40 de Brasilia. */
const CAPTURA = new Date('2026-10-28T17:40:00.000Z');

describe('JobbolScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: JobbolScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => FIXTURE);
    provider = new JobbolScraperProvider(http, ['salvador-ba'], () => CAPTURA);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('jobbol');
    expect(provider.label).toBe('Jobbol');
  });

  describe('requisicao', () => {
    it('consulta a pagina da area de TI de cada cidade configurada', async () => {
      await new JobbolScraperProvider(
        http,
        ['salvador-ba', 'lauro-de-freitas-ba'],
        () => CAPTURA,
      ).scrape();

      expect(http.requestedUrls).toEqual([
        'https://www.jobbol.com.br/areas/informatica-ti/salvador-ba',
        'https://www.jobbol.com.br/areas/informatica-ti/lauro-de-freitas-ba',
      ]);
    });

    it('cobre Salvador e a regiao metropolitana por padrao', () => {
      expect(JOBBOL_DEFAULT_CITIES).toEqual([
        'salvador-ba',
        'lauro-de-freitas-ba',
        'camacari-ba',
        'simoes-filho-ba',
      ]);
    });

    it('envia User-Agent de navegador, que o site exige para servir o HTML', async () => {
      await provider.scrape();

      const headers = http.requests[0]?.options?.headers ?? {};

      expect(headers['User-Agent']).toMatch(/Mozilla/);
      expect(headers['Accept']).toContain('text/html');
    });

    it('nao acessa /busca, bloqueado no robots.txt do site', async () => {
      await new JobbolScraperProvider(http, JOBBOL_DEFAULT_CITIES, () => CAPTURA).scrape();

      expect(http.requestedUrls.some((url) => url.includes('/busca'))).toBe(false);
    });
  });

  describe('parse dos cards', () => {
    it('mapeia a vaga para o formato do DevRadar', async () => {
      const [job] = await provider.scrape();

      expect(job).toMatchObject({
        title: 'DESENVOLVEDOR WEB',
        company: 'Empresa de Tecnologia',
        source: 'jobbol',
        url: 'https://www.jobbol.com.br/vaga/29387162668',
        location: 'Salvador / BA',
        publishedAtSource: 'SOURCE',
      });
    });

    it('descarta os blocos de anuncio, que nao tem titulo nem link de vaga', async () => {
      const jobs = await provider.scrape();

      // A fixture tem 6 blocos `card-vaga`; um deles e publicidade.
      expect(jobs).toHaveLength(5);
      expect(jobs.every((job) => job.url.includes('/vaga/'))).toBe(true);
    });

    it('preserva o bairro quando a cidade vem detalhada', async () => {
      const jobs = await provider.scrape();
      const comBairro = jobs.find((job) => job.title.includes('SUPORTE'));

      expect(comBairro?.location).toBe('Salvador / BA - Centro');
    });

    it('guarda o resumo do card como descricao', async () => {
      const [job] = await provider.scrape();

      expect(job?.description).toContain('área de Informática / TI');
    });

    it('nao perde acentuacao no nome da empresa', async () => {
      const jobs = await provider.scrape();

      expect(jobs.map((job) => job.company)).toContain('Clínica médica');
    });
  });

  describe('data de publicacao', () => {
    it('usa a idade relativa do resumo, que tem precisao de hora', async () => {
      const [job] = await provider.scrape();

      // "postada ha 23 horas" sobre a captura de 28/10 14:40 -> 27/10 15:40.
      expect(job?.publishedAt?.toISOString()).toBe('2026-10-27T18:40:00.000Z');
    });

    it('entende idade em dias', async () => {
      const jobs = await provider.scrape();
      const umDia = jobs.find((job) => job.title.includes('FULL STACK'));

      expect(umDia?.publishedAt?.toISOString()).toBe('2026-10-27T17:40:00.000Z');
    });

    it('marca a origem da data como informada pela fonte', async () => {
      const jobs = await provider.scrape();

      expect(jobs.every((job) => job.publishedAtSource === 'SOURCE')).toBe(true);
    });

    it('cai para a data do card, ao meio-dia de Brasilia, sem idade relativa', async () => {
      const semResumo = FIXTURE.replace(/postada h[aá] \d+ (hora|dia)s?/g, 'publicada');
      const semIdade = new JobbolScraperProvider(
        new FakeHttpClient(() => semResumo),
        ['salvador-ba'],
        () => CAPTURA,
      );

      const [job] = await semIdade.scrape();

      expect(job?.publishedAt?.toISOString()).toBe('2026-10-27T15:00:00.000Z');
      expect(job?.publishedAtSource).toBe('SOURCE');
    });

    it('sai sem data quando o card nao traz nem idade nem data valida', async () => {
      const semData = FIXTURE.replace(/postada h[aá] \d+ (hora|dia)s?/g, 'publicada').replace(
        /<p class='card-data'>[^<]*<\/p>/g,
        "<p class='card-data'></p>",
      );
      const provedor = new JobbolScraperProvider(
        new FakeHttpClient(() => semData),
        ['salvador-ba'],
        () => CAPTURA,
      );

      const [job] = await provedor.scrape();

      expect(job?.publishedAt).toBeUndefined();
      expect(job?.publishedAtSource).toBe('CAPTURE');
    });
  });

  describe('contrato do coletor', () => {
    it('remove a mesma vaga repetida entre cidades vizinhas', async () => {
      const jobs = await new JobbolScraperProvider(
        http,
        ['salvador-ba', 'lauro-de-freitas-ba'],
        () => CAPTURA,
      ).scrape();

      // As duas cidades devolvem a mesma fixture; o resultado nao pode dobrar.
      expect(jobs).toHaveLength(5);
    });

    it('devolve lista vazia quando a fonte esta fora do ar, sem propagar excecao', async () => {
      const fora = new JobbolScraperProvider(failingHttpClient(), ['salvador-ba'], () => CAPTURA);

      await expect(fora.scrape()).resolves.toEqual([]);
    });

    it('devolve lista vazia quando o HTML muda e nao ha mais cards', async () => {
      const vazio = new JobbolScraperProvider(
        new FakeHttpClient(() => '<html><body><p>sem vagas</p></body></html>'),
        ['salvador-ba'],
        () => CAPTURA,
      );

      await expect(vazio.scrape()).resolves.toEqual([]);
    });
  });
});
