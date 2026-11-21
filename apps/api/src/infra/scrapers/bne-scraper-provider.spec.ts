import { beforeEach, describe, expect, it } from 'vitest';

import { BNE_INTERVAL_IN_HOURS } from '@/domain/services/source-cadence';
import {
  BNE_DEFAULT_SEARCHES,
  BNE_MAX_DETAILS_PER_CYCLE,
  BNE_REQUEST_DELAY_IN_MS,
  BneScraperProvider,
  bneSearchUrl,
  type BneSearch,
} from '@/infra/scrapers/bne-scraper-provider';
import { FakeHttpClient, readFixture } from '../../../test/factories/fake-http-client';

const LISTAGEM = readFixture('bne-jobs.html');
const LISTAGEM_FULL_STACK = readFixture('bne-jobs-full-stack.html');
const DETALHE = readFixture('bne-job-detail.html');

/** As fixtures foram capturadas em 21/11/2026, por volta das 10h de Brasilia. */
const CAPTURA = new Date('2026-11-21T13:00:00.000Z');

/** `datePosted` da fixture de detalhe: 28/09/2026, ao meio-dia de Brasilia. */
const PUBLICADA_EM = '2026-09-28T15:00:00.000Z';

/** O site serve 20 cards por pagina de busca. */
const CARDS_POR_PAGINA = 20;

const SALVADOR: BneSearch = { role: 'desenvolvedor', city: 'salvador-ba' };

const SALVADOR_URL = 'https://www.bne.com.br/vagas-de-emprego-para-desenvolvedor-em-salvador-ba';

function isDetail(url: string): boolean {
  return url.includes('/vaga-de-emprego-na-area-');
}

/** Fake do site: as buscas devolvem listagem, as paginas de vaga o detalhe. */
function bneSite(detail: string = DETALHE): FakeHttpClient {
  return new FakeHttpClient((url) => {
    if (isDetail(url)) {
      return detail;
    }

    return url.includes('full-stack') ? LISTAGEM_FULL_STACK : LISTAGEM;
  });
}

/** Nunca rodou: a cadencia libera a captura e o teste olha so o parser. */
const NUNCA_RODOU = { getLastRunAt: async (): Promise<Date | null> => null };

function lastRunAt(moment: Date): { getLastRunAt: () => Promise<Date | null> } {
  return { getLastRunAt: async (): Promise<Date | null> => moment };
}

function provider(
  http: FakeHttpClient,
  searches: readonly BneSearch[] = [SALVADOR],
  options: {
    readonly lastRun?: { getLastRunAt: () => Promise<Date | null> };
    readonly maxDetails?: number;
    readonly waits?: number[];
  } = {},
): BneScraperProvider {
  const waits = options.waits ?? [];

  return new BneScraperProvider(
    http,
    options.lastRun ?? NUNCA_RODOU,
    searches,
    async (ms: number) => {
      waits.push(ms);
    },
    options.maxDetails ?? 120,
    () => CAPTURA,
  );
}

describe('BneScraperProvider', () => {
  let http: FakeHttpClient;

  beforeEach(() => {
    http = bneSite();
  });

  it('identifica a fonte', () => {
    expect(provider(http).source).toBe('bne');
    expect(provider(http).label).toBe('BNE');
  });

  describe('urls de busca', () => {
    it('monta a busca por funcao e cidade no formato de slug do site', () => {
      expect(bneSearchUrl(SALVADOR)).toBe(SALVADOR_URL);
    });

    it('usa o unico filtro de modalidade que a busca aceita, e nao um parametro de cidade', () => {
      expect(bneSearchUrl({ role: 'desenvolvedor', homeOffice: true })).toBe(
        'https://www.bne.com.br/vagas-de-emprego-para-desenvolvedor?HomeOffice=True',
      );
    });

    it('cobre a Bahia por Salvador e o remoto pelo filtro home office', () => {
      expect(BNE_DEFAULT_SEARCHES.map(bneSearchUrl)).toEqual([
        SALVADOR_URL,
        'https://www.bne.com.br/vagas-de-emprego-para-desenvolvedor-full-stack-em-salvador-ba',
        'https://www.bne.com.br/vagas-de-emprego-para-programador-em-salvador-ba',
        'https://www.bne.com.br/vagas-de-emprego-para-desenvolvedor?HomeOffice=True',
        'https://www.bne.com.br/vagas-de-emprego-para-desenvolvedor-full-stack?HomeOffice=True',
        'https://www.bne.com.br/vagas-de-emprego-para-programador?HomeOffice=True',
      ]);
    });
  });

  describe('requisicao', () => {
    it('visita a busca e depois a pagina de cada vaga candidata', async () => {
      await provider(http).scrape();

      expect(http.requestedUrls[0]).toBe(SALVADOR_URL);
      expect(http.requestedUrls.slice(1).every(isDetail)).toBe(true);
      expect(http.requestedUrls).toHaveLength(5);
    });

    it('envia User-Agent de navegador, que o WAF do site exige', async () => {
      await provider(http).scrape();

      const headers = http.requests[0]?.options?.headers ?? {};

      expect(headers['User-Agent']).toMatch(/Mozilla/);
      expect(headers['Accept']).toContain('text/html');
    });

    it('espaca as requisicoes, menos a primeira, para proteger o ip', async () => {
      const waits: number[] = [];

      await provider(http, [SALVADOR], { waits }).scrape();

      expect(waits).toEqual(Array.from({ length: 4 }, () => BNE_REQUEST_DELAY_IN_MS));
    });

    it('respeita o teto de detalhes por ciclo', async () => {
      const jobs = await provider(http, [SALVADOR], { maxDetails: 2 }).scrape();

      expect(jobs).toHaveLength(2);
      expect(http.requestedUrls.filter(isDetail)).toHaveLength(2);
    });

    it('o teto padrao cobre as seis buscas sem cortar candidata', () => {
      expect(BNE_MAX_DETAILS_PER_CYCLE).toBeGreaterThanOrEqual(
        BNE_DEFAULT_SEARCHES.length * CARDS_POR_PAGINA,
      );
    });
  });

  describe('parse dos cards', () => {
    it('mapeia a vaga para o formato do DevRadar', async () => {
      const [job] = await provider(http).scrape();

      expect(job).toMatchObject({
        title: 'Desenvolvedor',
        company: 'Softwell',
        source: 'bne',
        url: 'https://www.bne.com.br/vaga-de-emprego-na-area-informatica-em-salvador-ba/desenvolvedor/6200347',
        location: 'Salvador / BA',
        workModel: 'ONSITE',
        publishedAtSource: 'SOURCE',
      });
    });

    it('le a modalidade do card, que e onde o home office aparece', async () => {
      const jobs = await provider(http).scrape();
      const remota = jobs.find((job) => job.company === 'Stefanini Group');

      expect(remota?.workModel).toBe('REMOTE');
      expect(jobs.filter((job) => job.workModel === 'REMOTE')).toHaveLength(1);
    });

    it('preserva a empresa como a listagem a informa, inclusive sem nome', async () => {
      const jobs = await provider(http).scrape();

      expect(jobs.map((job) => job.company)).toEqual([
        'Softwell',
        'Confidencial',
        'Stefanini Group',
        'Horizon',
      ]);
    });

    it('tira do titulo a cidade que o site acrescenta no fim', async () => {
      const jobs = await provider(bneSite(), [{ role: 'desenvolvedor-full-stack' }]).scrape();

      expect(jobs.map((job) => job.title)).toEqual([
        'Desenvolvedor Full Stack',
        'Desenvolvedor Back-End',
        'Desenvolvedor Full Stack Pleno/Sênior - Ia',
      ]);
    });

    it('cai para o texto do link, sem o prefixo de vaga, quando falta o atributo', async () => {
      const semAtributo = LISTAGEM_FULL_STACK.replace(/title="[^"]*em [^"]*\/[A-Z]{2}"/g, '');
      const http2 = new FakeHttpClient((url) => (isDetail(url) ? DETALHE : semAtributo));

      const jobs = await provider(http2, [{ role: 'desenvolvedor-full-stack' }]).scrape();

      expect(jobs.map((job) => job.title)).toContain('Desenvolvedor Back-End');
    });

    it('descarta o card cujo titulo nao e cargo de desenvolvimento', async () => {
      const jobs = await provider(bneSite(), [{ role: 'desenvolvedor-full-stack' }]).scrape();

      // A fixture tem 4 cards; um deles e "Teste Vaga De Publicacao".
      expect(jobs).toHaveLength(3);
      expect(jobs.some((job) => job.title.includes('Teste'))).toBe(false);
    });

    it('nao pede o detalhe do card descartado', async () => {
      await provider(http, [{ role: 'desenvolvedor-full-stack' }]).scrape();

      expect(http.requestedUrls.some((url) => url.includes('5212861'))).toBe(false);
    });

    it('remove a mesma vaga repetida entre duas buscas', async () => {
      const jobs = await provider(http, [SALVADOR, { role: 'programador', city: 'salvador-ba' }])
        .scrape();

      expect(jobs).toHaveLength(4);
    });
  });

  describe('dados que so o detalhe tem', () => {
    it('usa a data de publicacao do JSON-LD da pagina da vaga', async () => {
      const jobs = await provider(http).scrape();

      expect(jobs.every((job) => job.publishedAt?.toISOString() === PUBLICADA_EM)).toBe(true);
      expect(jobs.every((job) => job.publishedAtSource === 'SOURCE')).toBe(true);
    });

    it('guarda a descricao completa, e nao o resumo cortado do card', async () => {
      const [job] = await provider(http).scrape();

      expect(job?.description).toContain('Beneficios');
      expect(job?.description).not.toContain('...');
    });

    it('cai para o resumo do card quando a pagina da vaga nao tem descricao', async () => {
      const semDescricao = DETALHE.replace(/"description": "[^"]*",/, '');

      const [job] = await provider(bneSite(semDescricao)).scrape();

      expect(job?.description).toContain('ia generativa');
      expect(job?.description).not.toContain('Beneficios');
    });

    it('deixa a vaga fora quando a pagina nao informa a data', async () => {
      const semData = DETALHE.replace(/"datePosted": "[^"]*",/, '');

      await expect(provider(bneSite(semData)).scrape()).resolves.toEqual([]);
    });

    it('deixa fora o anuncio ja vencido', async () => {
      const vencido = DETALHE.replace('"validThrough": "2027-09-28"', '"validThrough": "2026-10-01"');

      await expect(provider(bneSite(vencido)).scrape()).resolves.toEqual([]);
    });
  });

  describe('cadencia', () => {
    it('roda quando a fonte nunca foi visitada', async () => {
      await expect(provider(http).isDue(CAPTURA)).resolves.toBe(true);
    });

    it('adia a captura dentro do intervalo da fonte', async () => {
      const recem = new Date(CAPTURA.getTime() - (BNE_INTERVAL_IN_HOURS - 1) * 3_600_000);

      await expect(
        provider(http, [SALVADOR], { lastRun: lastRunAt(recem) }).isDue(CAPTURA),
      ).resolves.toBe(false);
    });

    it('libera a captura depois do intervalo da fonte', async () => {
      const antes = new Date(CAPTURA.getTime() - BNE_INTERVAL_IN_HOURS * 3_600_000);

      await expect(
        provider(http, [SALVADOR], { lastRun: lastRunAt(antes) }).isDue(CAPTURA),
      ).resolves.toBe(true);
    });

    it('nao gasta uma requisicao quando a chamada vem antes da hora', async () => {
      const recem = new Date(CAPTURA.getTime() - 60_000);

      const jobs = await provider(http, [SALVADOR], { lastRun: lastRunAt(recem) }).scrape();

      expect(jobs).toEqual([]);
      expect(http.requestedUrls).toEqual([]);
    });
  });

  describe('contrato do coletor', () => {
    it('devolve lista vazia quando a busca esta fora do ar, sem propagar excecao', async () => {
      const fora = new FakeHttpClient(() => new Error('fonte fora do ar'));

      await expect(provider(fora).scrape()).resolves.toEqual([]);
    });

    it('perde apenas a vaga cujo detalhe falhou', async () => {
      const detalheInstavel = new FakeHttpClient((url) => {
        if (!isDetail(url)) {
          return LISTAGEM;
        }

        return url.includes('6200347') ? new Error('410 Gone') : DETALHE;
      });

      const jobs = await provider(detalheInstavel).scrape();

      expect(jobs).toHaveLength(3);
      expect(jobs.some((job) => job.url.includes('6200347'))).toBe(false);
    });

    it('devolve lista vazia quando o HTML muda e nao ha mais cards', async () => {
      const vazio = new FakeHttpClient(() => '<html><body><p>sem vagas</p></body></html>');

      await expect(provider(vazio).scrape()).resolves.toEqual([]);
    });
  });
});
