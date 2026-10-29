import { beforeEach, describe, expect, it } from 'vitest';

import {
  GITHUB_VACANCY_REPOSITORIES,
  GithubIssuesScraperProvider,
} from '@/infra/scrapers/github-issues-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readJsonFixture,
} from '../../../test/factories/fake-http-client';

const ISSUES = readJsonFixture<unknown[]>('github-issues.json');

describe('GithubIssuesScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: GithubIssuesScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => ISSUES);
    provider = new GithubIssuesScraperProvider(http, ['frontendbr/vagas']);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('github');
  });

  it('monitora os tres repositorios de vagas por padrao', () => {
    expect(GITHUB_VACANCY_REPOSITORIES).toEqual([
      'frontendbr/vagas',
      'react-brasil/vagas',
      'backend-br/vagas',
    ]);
  });

  it('consulta a api de issues abertas ordenadas pelas mais recentes', async () => {
    await provider.scrape();

    expect(http.requestedUrls[0]).toBe(
      'https://api.github.com/repos/frontendbr/vagas/issues' +
        '?state=open&sort=created&direction=desc&per_page=50',
    );
    expect(http.requests[0]?.options?.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
    });
  });

  it('consulta um endereco por repositorio configurado', async () => {
    await new GithubIssuesScraperProvider(http).scrape();

    expect(http.requestedUrls).toHaveLength(GITHUB_VACANCY_REPOSITORIES.length);
  });

  it('separa cargo e empresa pela convencao "Cargo na Empresa"', async () => {
    const jobs = await provider.scrape();

    expect(jobs[1]).toMatchObject({
      title: 'Senior Software Engineer, Full Stack, Kids and Families',
      company: 'Google',
      location: 'Belo Horizonte, Brasil',
      workModel: 'ONSITE',
      recruiterName: 'FrancieleGhizzoni',
      publishedAtSource: 'SOURCE',
    });
  });

  it('cai para o autor da issue quando o titulo nao informa a empresa', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]).toMatchObject({
      title: 'It Jobs (Strider/ Micro 1)',
      company: 'Claudiaantunesdelima',
      location: 'Remoto',
      workModel: 'REMOTE',
    });
  });

  it('usa as labels da issue como tags e para inferir a modalidade', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]?.tags).toEqual(['Remoto']);
    expect(jobs[2]?.tags).toEqual(['Alocado', 'São Paulo']);
    expect(jobs[2]?.workModel).toBe('ONSITE');
  });

  it('preserva url e data de criacao da issue', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]?.url).toBe('https://github.com/frontendbr/vagas/issues/8571');
    expect(jobs[0]?.publishedAt?.toISOString()).toBe('2026-10-19T16:48:53.000Z');
  });

  describe('metadados no titulo nunca viram empresa', () => {
    it('extrai a empresa de uma issue real com jornada depois do travessao', async () => {
      const provider = new GithubIssuesScraperProvider(http, ['frontendbr/vagas']);

      const jobs = await provider.scrape();
      const weatherwise = jobs.find((job) => job.url.endsWith('/8572'));

      // Titulo: "[Remoto] Senior Front-end / Product Engineer na WeatherWise — 4 dias / 32h"
      expect(weatherwise).toMatchObject({
        title: 'Senior Front-end / Product Engineer',
        company: 'WeatherWise',
      });
    });

    it.each([
      [
        'jornada depois do travessao',
        '[Remoto] Senior Front-end / Product Engineer (React/TypeScript) na WeatherWise — 4 dias / 32h',
        'Senior Front-end / Product Engineer (React/TypeScript)',
        'WeatherWise',
      ],
      [
        'area antes da empresa e jornada depois da barra vertical',
        '[Remoto] Desenvolvedor(a) Full Stack Sênior — AI & Agents na WeatherWise | 4 dias / 32h',
        'Desenvolvedor(a) Full Stack Sênior',
        'WeatherWise',
      ],
      [
        'faixa salarial depois da empresa',
        '[Remoto] Dev React na Acme Corp — R$ 12k',
        'Dev React',
        'Acme Corp',
      ],
      [
        'carga horaria depois da empresa',
        '[Remoto] Dev React - Acme Corp - 20h semanais',
        'Dev React',
        'Acme Corp',
      ],
    ])('%s', async (_caso, title, esperadoTitulo, esperadaEmpresa) => {
      const provider = new GithubIssuesScraperProvider(
        new FakeHttpClient(() => [issue({ title })]),
        ['frontendbr/vagas'],
      );

      const jobs = await provider.scrape();

      expect(jobs[0]).toMatchObject({ title: esperadoTitulo, company: esperadaEmpresa });
    });

    it('cai para o autor quando so sobra metadado depois do separador', async () => {
      const provider = new GithubIssuesScraperProvider(
        new FakeHttpClient(() => [issue({ title: '[Remoto] Dev React — 4 dias / 32h' })]),
        ['frontendbr/vagas'],
      );

      const jobs = await provider.scrape();

      expect(jobs[0]).toMatchObject({ title: 'Dev React', company: 'octocat' });
    });
  });

  it.each([
    [' - ', '[Remoto] Dev Frontend - Acme Corp', 'Dev Frontend', 'Acme Corp'],
    [' | ', '[Remoto] Dev Frontend | Acme Corp', 'Dev Frontend', 'Acme Corp'],
    [' @ ', '[Remoto] Dev Frontend @ Acme Corp', 'Dev Frontend', 'Acme Corp'],
    [' – ', '[Remoto] Dev Frontend – Acme Corp', 'Dev Frontend', 'Acme Corp'],
    [' — ', '[Remoto] Dev Frontend — Acme Corp', 'Dev Frontend', 'Acme Corp'],
  ])('reconhece o separador "%s"', async (_label, title, expectedTitle, expectedCompany) => {
    const provider = new GithubIssuesScraperProvider(
      new FakeHttpClient(() => [issue({ title })]),
      ['frontendbr/vagas'],
    );

    const jobs = await provider.scrape();

    expect(jobs[0]).toMatchObject({ title: expectedTitle, company: expectedCompany });
  });

  it('ignora pull requests', async () => {
    const provider = new GithubIssuesScraperProvider(
      new FakeHttpClient(() => [issue({ pull_request: { url: 'https://api.github.com/pulls/1' } })]),
      ['frontendbr/vagas'],
    );

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it.each([
    ['sem titulo', { title: '' }],
    ['sem url', { html_url: '' }],
    ['com data invalida', { created_at: 'ontem' }],
  ])('descarta issue %s', async (_label, overrides) => {
    const provider = new GithubIssuesScraperProvider(
      new FakeHttpClient(() => [issue(overrides)]),
      ['frontendbr/vagas'],
    );

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('descarta issue sem empresa e sem autor', async () => {
    const provider = new GithubIssuesScraperProvider(
      new FakeHttpClient(() => [issue({ title: '[Remoto] Dev Frontend', user: null })]),
      ['frontendbr/vagas'],
    );

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('nao trata hifen solto no fim do titulo como separador de empresa', async () => {
    const provider = new GithubIssuesScraperProvider(
      new FakeHttpClient(() => [issue({ title: '[Remoto] Dev Frontend - ' })]),
      ['frontendbr/vagas'],
    );

    const jobs = await provider.scrape();

    expect(jobs[0]).toMatchObject({ title: 'Dev Frontend -', company: 'octocat' });
  });

  it('trata titulo sem modalidade entre colchetes', async () => {
    const provider = new GithubIssuesScraperProvider(
      new FakeHttpClient(() => [issue({ title: 'Dev Frontend - Acme Corp', labels: [] })]),
      ['frontendbr/vagas'],
    );

    const jobs = await provider.scrape();

    expect(jobs[0]).toMatchObject({
      location: '',
      workModel: 'UNKNOWN',
      company: 'Acme Corp',
      tags: [],
    });
  });

  it('infere a modalidade pela label quando o titulo nao traz colchetes', async () => {
    const provider = new GithubIssuesScraperProvider(
      new FakeHttpClient(() => [issue({ title: 'Dev Frontend - Acme Corp' })]),
      ['frontendbr/vagas'],
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.workModel).toBe('REMOTE');
  });

  it('trata issue sem labels', async () => {
    const provider = new GithubIssuesScraperProvider(
      new FakeHttpClient(() => [issue({ labels: undefined })]),
      ['frontendbr/vagas'],
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.tags).toEqual([]);
  });

  it('devolve lista vazia quando a api nao retorna um array', async () => {
    const provider = new GithubIssuesScraperProvider(
      new FakeHttpClient(() => ({ message: 'API rate limit exceeded' })),
      ['frontendbr/vagas'],
    );

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando a fonte falha, sem propagar excecao', async () => {
    const provider = new GithubIssuesScraperProvider(failingHttpClient(), ['frontendbr/vagas']);

    await expect(provider.scrape()).resolves.toEqual([]);
  });
});

function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '[Remoto] Dev Frontend - Acme Corp',
    html_url: 'https://github.com/frontendbr/vagas/issues/1',
    created_at: '2026-10-25T10:00:00Z',
    body: 'Vaga para atuar com React.',
    state: 'open',
    user: { login: 'octocat' },
    labels: [{ name: 'Remoto' }],
    ...overrides,
  };
}
