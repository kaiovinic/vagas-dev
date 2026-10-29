import { beforeEach, describe, expect, it } from 'vitest';

import {
  SOLIDES_DEFAULT_QUERIES,
  SOLIDES_PAGE_SIZE,
  SolidesScraperProvider,
} from '@/infra/scrapers/solides-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readJsonFixture,
} from '../../../test/factories/fake-http-client';

const FIXTURE = readJsonFixture<unknown>('solides.json');

/** A fixture foi capturada em 29/10/2026. */
const CAPTURA = new Date('2026-10-29T12:00:00.000Z');

describe('SolidesScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: SolidesScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => FIXTURE);
    provider = new SolidesScraperProvider(http, [{ locations: 'BA', pages: 1 }], () => CAPTURA);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('solides');
    expect(provider.label).toBe('Solides');
  });

  describe('requisicao', () => {
    it('consulta a api de vagas da area de tecnologia', async () => {
      await provider.scrape();

      const url = new URL(http.requestedUrls[0] ?? '');

      expect(url.origin + url.pathname).toBe('https://vagas.solides.com.br/api/vacancies');
      expect(url.searchParams.get('occupationAreas')).toBe('tecnologia');
      expect(url.searchParams.get('locations')).toBe('BA');
      expect(url.searchParams.get('take')).toBe(String(SOLIDES_PAGE_SIZE));
    });

    it('usa pagina de 24, o maior tamanho que a api aceita', () => {
      expect(SOLIDES_PAGE_SIZE).toBe(24);
    });

    it('pagina a consulta', async () => {
      const paginado = new SolidesScraperProvider(
        http,
        [{ locations: 'BA', pages: 3 }],
        () => CAPTURA,
      );

      await paginado.scrape();

      expect(http.requestedUrls.map((url) => new URL(url).searchParams.get('page'))).toEqual([
        '1',
        '2',
        '3',
      ]);
    });

    it('cobre a Bahia inteira e o feed nacional por padrao', () => {
      expect(SOLIDES_DEFAULT_QUERIES.map((query) => query.locations)).toEqual(['BA', '']);
    });

    it('pede menos paginas do feed nacional, que e ordenado por data', () => {
      const nacional = SOLIDES_DEFAULT_QUERIES.find((query) => query.locations === '');

      expect(nacional?.pages).toBeLessThanOrEqual(6);
    });
  });

  describe('mapeamento da vaga', () => {
    it('monta a vaga no formato do DevRadar', async () => {
      const jobs = await provider.scrape();
      const salvador = jobs.find((job) => job.location?.startsWith('Salvador'));

      expect(salvador).toMatchObject({
        title: 'Líder técnico',
        company: '49.543.007 VINICIUS PARODE FEIJO',
        source: 'solides',
        location: 'Salvador - BA',
        workModel: 'ONSITE',
        publishedAtSource: 'SOURCE',
      });
    });

    it('monta a url publica da vaga a partir do id', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]?.url).toMatch(/^https:\/\/vagas\.solides\.com\.br\/vaga\/\d+$/);
    });

    it.each([
      ['remoto', 'REMOTE'],
      ['hibrido', 'HYBRID'],
      ['presencial', 'ONSITE'],
    ])('traduz a modalidade %s em %s', async (jobType, esperado) => {
      const umaVaga = new SolidesScraperProvider(
        new FakeHttpClient(() => ({ data: [vacancy({ jobType })] })),
        [{ locations: 'BA', pages: 1 }],
        () => CAPTURA,
      );

      const jobs = await umaVaga.scrape();

      expect(jobs[0]?.workModel).toBe(esperado);
    });

    it('usa modalidade desconhecida quando a api nao informa', async () => {
      const semTipo = new SolidesScraperProvider(
        new FakeHttpClient(() => ({ data: [vacancy({ jobType: null })] })),
        [{ locations: 'BA', pages: 1 }],
        () => CAPTURA,
      );

      const jobs = await semTipo.scrape();

      expect(jobs[0]?.workModel).toBe('UNKNOWN');
    });

    it('sai sem localidade quando a vaga nao tem cidade nem estado', async () => {
      const jobs = await provider.scrape();
      const semEndereco = jobs.find((job) => job.company === 'Empresa Sem Endereco');

      expect(semEndereco?.location).toBe('');
    });

    it('leva as hard skills e o regime como etiquetas', async () => {
      const comTags = new SolidesScraperProvider(
        new FakeHttpClient(() => ({
          data: [
            vacancy({
              hardSkills: [{ id: 1, name: 'React' }],
              recruitmentContractType: [{ id: 10, name: 'CLT' }],
            }),
          ],
        })),
        [{ locations: 'BA', pages: 1 }],
        () => CAPTURA,
      );

      const jobs = await comTags.scrape();

      expect(jobs[0]?.tags).toEqual(['React', 'CLT']);
    });
  });

  describe('data de publicacao', () => {
    it('ancora a data no meio-dia de Brasilia, nao na meia-noite UTC', async () => {
      const jobs = await provider.scrape();
      const salvador = jobs.find((job) => job.location?.startsWith('Salvador'));

      // createdAt da fixture: "2026-10-19". Meia-noite UTC cairia em 18/10 aqui.
      expect(salvador?.publishedAt?.toISOString()).toBe('2026-10-19T15:00:00.000Z');
    });

    it('descarta a vaga sem data utilizavel', async () => {
      const semData = new SolidesScraperProvider(
        new FakeHttpClient(() => ({ data: [vacancy({ createdAt: null })] })),
        [{ locations: 'BA', pages: 1 }],
        () => CAPTURA,
      );

      await expect(semData.scrape()).resolves.toEqual([]);
    });
  });

  describe('contrato do coletor', () => {
    it('descarta registro sem titulo, empresa ou id', async () => {
      const quebrado = new SolidesScraperProvider(
        new FakeHttpClient(() => ({
          data: [vacancy({ title: '' }), vacancy({ companyName: '' }), vacancy({ id: null })],
        })),
        [{ locations: 'BA', pages: 1 }],
        () => CAPTURA,
      );

      await expect(quebrado.scrape()).resolves.toEqual([]);
    });

    it('remove a mesma vaga repetida entre as consultas', async () => {
      const duasConsultas = new SolidesScraperProvider(
        http,
        [
          { locations: 'BA', pages: 1 },
          { locations: '', pages: 1 },
        ],
        () => CAPTURA,
      );

      const jobs = await duasConsultas.scrape();

      expect(http.requestedUrls).toHaveLength(2);
      expect(jobs).toHaveLength(4);
    });

    it('devolve lista vazia quando a api esta fora do ar', async () => {
      const fora = new SolidesScraperProvider(
        failingHttpClient(),
        [{ locations: 'BA', pages: 1 }],
        () => CAPTURA,
      );

      await expect(fora.scrape()).resolves.toEqual([]);
    });

    it('devolve lista vazia quando a resposta nao tem a lista esperada', async () => {
      const estranho = new SolidesScraperProvider(
        new FakeHttpClient(() => ({ mensagem: 'sem vagas' })),
        [{ locations: 'BA', pages: 1 }],
        () => CAPTURA,
      );

      await expect(estranho.scrape()).resolves.toEqual([]);
    });
  });
});

/** Vaga minima no formato da api, para os casos de borda. */
function vacancy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 123456,
    title: 'Pessoa Desenvolvedora React',
    companyName: 'Acme Corp',
    description: '<p>Vaga de teste</p>',
    createdAt: '2026-10-28',
    jobType: 'remoto',
    city: { name: 'Salvador' },
    state: { code: 'BA' },
    hardSkills: [],
    recruitmentContractType: [],
    ...overrides,
  };
}
