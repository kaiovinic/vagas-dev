import { beforeEach, describe, expect, it } from 'vitest';

import {
  COODESH_MAX_JOB_PAGES,
  COODESH_SITEMAP_WINDOW_IN_DAYS,
  CoodeshScraperProvider,
} from '@/infra/scrapers/coodesh-scraper-provider';
import { FakeHttpClient, readFixture } from '../../../test/factories/fake-http-client';

const SITEMAP = readFixture('coodesh-sitemap.xml');
const JOB_PAGE = readFixture('coodesh-job.html');

/** As fixtures foram capturadas em 29/10/2026. */
const CAPTURA = new Date('2026-10-29T12:00:00.000Z');

/** Responde o sitemap na url do sitemap e a pagina de vaga nas demais. */
function fakeHttp(jobPage: string = JOB_PAGE): FakeHttpClient {
  return new FakeHttpClient((url) => (url.includes('sitemap') ? SITEMAP : jobPage));
}

function build(http: FakeHttpClient = fakeHttp()): CoodeshScraperProvider {
  return new CoodeshScraperProvider(http, () => CAPTURA);
}

describe('CoodeshScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: CoodeshScraperProvider;

  beforeEach(() => {
    http = fakeHttp();
    provider = build(http);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('coodesh');
    expect(provider.label).toBe('Coodesh');
  });

  describe('descoberta pelo sitemap', () => {
    it('comeca pelo sitemap de vagas', async () => {
      await provider.scrape();

      expect(http.requestedUrls[0]).toBe('https://coodesh.com/sitemaps/jobs.xml');
    });

    it('visita so as vagas com lastmod dentro da janela', async () => {
      await provider.scrape();

      // A fixture tem 4 entradas; a de 20/06/2026 fica de fora.
      expect(http.requestedUrls).toHaveLength(4);
      expect(http.requestedUrls.some((url) => url.includes('desenvolvedor-automacao'))).toBe(false);
    });

    it('usa uma janela de lastmod mais larga que a das regras', () => {
      // O lastmod e a data de alteracao da pagina, nao a da publicacao: cortar
      // em 72h aqui perderia vaga nova cuja pagina nao mudou desde ontem.
      expect(COODESH_SITEMAP_WINDOW_IN_DAYS).toBeGreaterThan(3);
    });

    it('limita quantas paginas de vaga visita por captura', () => {
      expect(COODESH_MAX_JOB_PAGES).toBeLessThanOrEqual(40);
    });

    it('devolve lista vazia quando o sitemap nao responde', async () => {
      const semSitemap = new CoodeshScraperProvider(
        new FakeHttpClient(() => new Error('502')),
        () => CAPTURA,
      );

      await expect(semSitemap.scrape()).resolves.toEqual([]);
    });

    it('devolve lista vazia quando o sitemap nao tem vaga', async () => {
      const vazio = new CoodeshScraperProvider(
        new FakeHttpClient(() => '<urlset></urlset>'),
        () => CAPTURA,
      );

      await expect(vazio.scrape()).resolves.toEqual([]);
    });
  });

  describe('leitura do JSON-LD', () => {
    it('mapeia a vaga no formato do DevRadar', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]).toMatchObject({
        title: 'Forward Deployed Engineer, Generative AI, Google Cloud (Spanish, English)',
        company: 'Google',
        source: 'coodesh',
        location: 'Bogotá - Bogota',
        publishedAtSource: 'SOURCE',
      });
    });

    it('usa a url da vaga como link de candidatura', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]?.url).toContain('https://coodesh.com/jobs/');
    });

    it('ancora o datePosted no meio-dia de Brasilia', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]?.publishedAt?.toISOString()).toBe('2026-10-28T15:00:00.000Z');
    });

    it('limpa o html da descricao', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]?.description).not.toContain('<');
    });

    it('marca TELECOMMUTE como remoto', async () => {
      const remoto = JOB_PAGE.replace('"@type": "JobPosting",', '"@type": "JobPosting", "jobLocationType": "TELECOMMUTE",');

      const jobs = await build(fakeHttp(remoto)).scrape();

      expect(jobs[0]?.workModel).toBe('REMOTE');
    });

    it('trata vaga com endereco e sem TELECOMMUTE como presencial', async () => {
      const jobs = await provider.scrape();

      expect(jobs[0]?.workModel).toBe('ONSITE');
    });

    it('ignora pagina sem bloco JobPosting', async () => {
      const semLd = fakeHttp('<html><head></head><body>sem dados</body></html>');

      await expect(build(semLd).scrape()).resolves.toEqual([]);
    });

    it('ignora json-ld malformado em vez de quebrar a captura', async () => {
      const quebrado = fakeHttp(
        '<script type="application/ld+json">{ isso nao e json }</script>',
      );

      await expect(build(quebrado).scrape()).resolves.toEqual([]);
    });

    it('nao propaga falha de uma pagina de vaga', async () => {
      const umaFalha = new FakeHttpClient((url) => {
        if (url.includes('sitemap')) {
          return SITEMAP;
        }

        return url.includes('manager-smb') ? new Error('500') : JOB_PAGE;
      });

      const jobs = await build(umaFalha).scrape();

      // As outras tres continuam, mesmo com uma pagina fora do ar.
      expect(jobs.length).toBeGreaterThan(0);
    });
  });

  describe('contrato do coletor', () => {
    it('devolve uma vaga por url do sitemap dentro da janela', async () => {
      const jobs = await provider.scrape();

      // Tres entradas passam no corte por lastmod; cada uma e uma vaga, com
      // url propria — e a url que identifica a vaga, nao o conteudo da pagina.
      expect(jobs).toHaveLength(3);
      expect(new Set(jobs.map((job) => job.url)).size).toBe(3);
    });

    it('nao repete a vaga se a mesma url aparecer duas vezes no sitemap', async () => {
      const repetida = [
        '  <url>',
        '    <loc>https://coodesh.com/jobs/forward-deployed-engineer-generative-ai-google-cloud-spanish-english-001719636</loc>',
        '    <lastmod>2026-10-29</lastmod>',
        '  </url>',
        '</urlset>',
      ].join('\n');
      const duplicado = SITEMAP.replace('</urlset>', repetida);
      const http = new FakeHttpClient((url) => (url.includes('sitemap') ? duplicado : JOB_PAGE));

      const jobs = await build(http).scrape();

      expect(jobs).toHaveLength(3);
    });

    it('nao propaga excecao quando tudo falha', async () => {
      const fora = new CoodeshScraperProvider(
        new FakeHttpClient(() => {
          throw new Error('rede fora');
        }),
        () => CAPTURA,
      );

      await expect(fora.scrape()).resolves.toEqual([]);
    });
  });
});
