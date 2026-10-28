import { beforeEach, describe, expect, it } from 'vitest';

import { GupyScraperProvider } from '@/infra/scrapers/gupy-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readFixture,
} from '../../../test/factories/fake-http-client';

const FIXTURE = readFixture('gupy-job-search.html');

describe('GupyScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: GupyScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => FIXTURE);
    provider = new GupyScraperProvider(http, ['frontend']);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('gupy');
    expect(provider.label).toBe('Gupy');
  });

  it('consulta o portal publico de busca com o termo codificado', async () => {
    await new GupyScraperProvider(http, ['front-end']).scrape();

    expect(http.requestedUrls).toEqual(['https://portal.gupy.io/job-search/term=front-end']);
  });

  it('consulta um endereco por termo configurado', async () => {
    await new GupyScraperProvider(http, ['frontend', 'react']).scrape();

    expect(http.requestedUrls).toHaveLength(2);
  });

  it('extrai as vagas do payload __NEXT_DATA__', async () => {
    const jobs = await provider.scrape();

    expect(jobs).toHaveLength(4);
    expect(jobs[0]).toMatchObject({
      title: 'Desenvolvedor FrontEnd React  - Sênior',
      source: 'gupy',
      publishedAtSource: 'SOURCE',
      workModel: 'REMOTE',
    });
    expect(jobs[0]?.publishedAt?.toISOString()).toBe('2026-10-26T13:04:12.591Z');
  });

  it('usa o subdominio do tenant como empresa, ignorando slogan de employer branding', async () => {
    const jobs = await provider.scrape();

    expect(jobs.map((job) => job.company)).toEqual([
      'Fcamara',
      'Verity',
      'Supergasbras',
      'Aurum',
    ]);
  });

  it('traduz workplaceType para a modalidade do dominio', async () => {
    const jobs = await provider.scrape();

    expect(jobs.map((job) => job.workModel)).toEqual(['REMOTE', 'REMOTE', 'HYBRID', 'REMOTE']);
  });

  it('monta a localidade a partir de cidade e estado e assume Remoto quando vazias', async () => {
    const jobs = await provider.scrape();

    expect(jobs[2]?.location).toBe('Rio de Janeiro - Rio de Janeiro');
    expect(jobs[0]?.location).toBe('Remoto');
  });

  it('deduplica a mesma vaga retornada por termos diferentes', async () => {
    const jobs = await new GupyScraperProvider(http, ['frontend', 'react', 'node']).scrape();

    expect(jobs).toHaveLength(4);
  });

  it('devolve lista vazia quando o html nao tem __NEXT_DATA__', async () => {
    const withoutData = new GupyScraperProvider(
      new FakeHttpClient(() => '<html><body>sem dados</body></html>'),
      ['frontend'],
    );

    await expect(withoutData.scrape()).resolves.toEqual([]);
  });

  it.each([
    ['payload sem a lista esperada', '<script id="__NEXT_DATA__">{"props":{}}</script>'],
    [
      'lista em formato inesperado',
      '<script id="__NEXT_DATA__">{"props":{"pageProps":{"initialJobList":{"data":"x"}}}}</script>',
    ],
  ])('devolve lista vazia quando o %s', async (_label, html) => {
    const provider = new GupyScraperProvider(new FakeHttpClient(() => html), ['frontend']);

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('descarta vagas sem titulo, url ou data', async () => {
    const payload = {
      props: {
        pageProps: {
          initialJobList: {
            data: [
              { name: '', jobUrl: 'https://acme.gupy.io/job/1', publishedDate: '2026-10-26T10:00:00Z' },
              { name: 'Dev React', jobUrl: '', publishedDate: '2026-10-26T10:00:00Z' },
              { name: 'Dev React', jobUrl: 'https://acme.gupy.io/job/2', publishedDate: 'invalida' },
              { name: 'Dev React', jobUrl: 'https://acme.gupy.io/job/3', publishedDate: '2026-10-26T10:00:00Z' },
            ],
          },
        },
      },
    };
    const provider = new GupyScraperProvider(
      new FakeHttpClient(() => `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`),
      ['frontend'],
    );

    const jobs = await provider.scrape();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.url).toBe('https://acme.gupy.io/job/3');
  });

  it('cai para o careerPageName quando a url nao e de um tenant gupy', async () => {
    const payload = {
      props: {
        pageProps: {
          initialJobList: {
            data: [
              {
                name: 'Dev Frontend',
                jobUrl: 'https://acme-jobs.com/vaga/1',
                careerPageName: 'Acme Corp',
                publishedDate: '2026-10-26T10:00:00Z',
                workplaceType: 'on-site',
                city: 'Salvador',
                state: 'Bahia',
              },
              {
                name: 'Dev Angular',
                jobUrl: 'nao-e-url',
                careerPageName: '',
                publishedDate: '2026-10-26T10:00:00Z',
              },
              {
                name: 'Dev Node',
                jobUrl: 'https://acme.gupy.io/job/9',
                publishedDate: '2026-10-26T10:00:00Z',
              },
            ],
          },
        },
      },
    };
    const provider = new GupyScraperProvider(
      new FakeHttpClient(() => `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`),
      ['frontend'],
    );

    const jobs = await provider.scrape();

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      company: 'Acme Corp',
      workModel: 'ONSITE',
      location: 'Salvador - Bahia',
    });
    expect(jobs[1]).toMatchObject({ company: 'Acme', workModel: 'UNKNOWN', location: '' });
  });

  it('devolve lista vazia quando a fonte falha, sem propagar excecao', async () => {
    const provider = new GupyScraperProvider(failingHttpClient(), ['frontend']);

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('usa os termos padrao quando nenhum e informado', async () => {
    const provider = new GupyScraperProvider(http);

    await provider.scrape();

    expect(http.requestedUrls.length).toBeGreaterThan(1);
  });
});
