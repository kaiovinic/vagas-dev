import { beforeEach, describe, expect, it } from 'vitest';

import {
  LINKEDIN_DEFAULT_SEARCHES,
  LINKEDIN_LAST_72H_FILTER,
  LinkedinGuestScraperProvider,
} from '@/infra/scrapers/linkedin-guest-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readFixture,
} from '../../../test/factories/fake-http-client';

const FIXTURE = readFixture('linkedin-guest-jobs.html');

const SALVADOR_SEARCH = {
  keywords: 'desenvolvedor frontend',
  location: 'Salvador, Bahia, Brazil',
  remoteOnly: false,
};

describe('LinkedinGuestScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: LinkedinGuestScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => FIXTURE);
    provider = new LinkedinGuestScraperProvider(http, [SALVADOR_SEARCH]);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('linkedin');
  });

  it('filtra as ultimas 72 horas na propria fonte', () => {
    expect(LINKEDIN_LAST_72H_FILTER).toBe('r259200');
  });

  it('consulta a rota guest com keywords, localidade e f_TPR', async () => {
    await provider.scrape();

    const url = http.requestedUrls[0] ?? '';

    expect(url).toContain(
      'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?',
    );
    expect(url).toContain('keywords=desenvolvedor+frontend');
    expect(url).toContain('location=Salvador%2C+Bahia%2C+Brazil');
    expect(url).toContain('f_TPR=r259200');
    expect(url).not.toContain('f_WT');
  });

  it('aplica f_WT=2 nas buscas de vagas remotas', async () => {
    const remote = new LinkedinGuestScraperProvider(http, [
      { keywords: 'react', location: 'Brazil', remoteOnly: true },
    ]);

    await remote.scrape();

    expect(http.requestedUrls[0]).toContain('f_WT=2');
  });

  it('cobre Salvador e Remoto para cada palavra-chave padrao', () => {
    expect(LINKEDIN_DEFAULT_SEARCHES.filter((search) => search.remoteOnly)).toHaveLength(
      LINKEDIN_DEFAULT_SEARCHES.length / 2,
    );
    expect(
      LINKEDIN_DEFAULT_SEARCHES.some(
        (search) => search.location === 'Salvador, Bahia, Brazil' && !search.remoteOnly,
      ),
    ).toBe(true);
  });

  it('extrai os cards de vaga do html guest', async () => {
    const jobs = await provider.scrape();

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      title: 'Desenvolvedor Front-end Júnior',
      company: 'Jobbol',
      location: 'Salvador, Bahia, Brazil',
      source: 'linkedin',
      publishedAtSource: 'SOURCE',
    });
  });

  it('remove a query de tracking da url da vaga', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]?.url).toBe(
      'https://br.linkedin.com/jobs/view/desenvolvedor-front-end-j%C3%BAnior-at-jobbol-4482768114',
    );
    expect(jobs[0]?.url).not.toContain('?');
  });

  it('le a data de publicacao do atributo datetime', async () => {
    const jobs = await provider.scrape();

    // O card guest so informa o dia; vira meio-dia de Brasilia (15:00 UTC) para
    // nao cair no dia anterior no fuso local.
    expect(jobs[0]?.publishedAt?.toISOString()).toBe('2026-10-23T15:00:00.000Z');
    expect(jobs[1]?.publishedAt?.toISOString()).toBe('2026-10-24T15:00:00.000Z');
  });

  it('mantem a vaga no mesmo dia do card quando lida no fuso de Brasilia', async () => {
    const jobs = await provider.scrape();
    const diaEmBrasilia = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Bahia',
      day: '2-digit',
      month: '2-digit',
    }).format(jobs[0]?.publishedAt);

    expect(diaEmBrasilia).toBe('23/10');
  });

  it('marca como remota toda vaga vinda da busca com f_WT=2', async () => {
    const remote = new LinkedinGuestScraperProvider(http, [
      { keywords: 'react', location: 'Brazil', remoteOnly: true },
    ]);

    const jobs = await remote.scrape();

    expect(jobs.map((job) => job.workModel)).toEqual(['REMOTE', 'REMOTE']);
  });

  it('deriva a modalidade do texto da localidade nas buscas presenciais', async () => {
    const jobs = await provider.scrape();

    expect(jobs.map((job) => job.workModel)).toEqual(['UNKNOWN', 'UNKNOWN']);
  });

  it('deduplica a mesma vaga encontrada em buscas diferentes', async () => {
    const twice = new LinkedinGuestScraperProvider(http, [
      SALVADOR_SEARCH,
      { ...SALVADOR_SEARCH, keywords: 'react' },
    ]);

    await expect(twice.scrape()).resolves.toHaveLength(2);
  });

  it.each([
    ['sem titulo', '<div class="base-card"><h4 class="base-search-card__subtitle">Acme</h4></div>'],
    [
      'sem empresa',
      '<div class="base-card"><h3 class="base-search-card__title">Dev</h3></div>',
    ],
    [
      'sem link',
      '<div class="base-card"><h3 class="base-search-card__title">Dev</h3>' +
        '<h4 class="base-search-card__subtitle">Acme</h4>' +
        '<time datetime="2026-10-24"></time></div>',
    ],
    [
      'sem data',
      '<div class="base-card"><h3 class="base-search-card__title">Dev</h3>' +
        '<h4 class="base-search-card__subtitle">Acme</h4>' +
        '<a class="base-card__full-link" href="https://br.linkedin.com/jobs/view/1"></a></div>',
    ],
  ])('descarta card %s', async (_label, html) => {
    const provider = new LinkedinGuestScraperProvider(new FakeHttpClient(() => html), [
      SALVADOR_SEARCH,
    ]);

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando o html nao tem cards', async () => {
    const provider = new LinkedinGuestScraperProvider(
      new FakeHttpClient(() => '<html><body></body></html>'),
      [SALVADOR_SEARCH],
    );

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando a fonte falha, sem propagar excecao', async () => {
    const provider = new LinkedinGuestScraperProvider(failingHttpClient(), [SALVADOR_SEARCH]);

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('usa as buscas padrao quando nenhuma e informada', async () => {
    const provider = new LinkedinGuestScraperProvider(http);

    await provider.scrape();

    expect(http.requestedUrls).toHaveLength(LINKEDIN_DEFAULT_SEARCHES.length);
  });
});
