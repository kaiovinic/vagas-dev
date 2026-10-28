import { beforeEach, describe, expect, it } from 'vitest';

import { RemotarScraperProvider } from '@/infra/scrapers/remotar-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readJsonFixture,
} from '../../../test/factories/fake-http-client';

const PAYLOAD = readJsonFixture<unknown>('remotar-jobs.json');

describe('RemotarScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: RemotarScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => PAYLOAD);
    provider = new RemotarScraperProvider(http, 1);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('remotar');
    expect(provider.label).toBe('Remotar');
  });

  it('consulta a api publica paginada', async () => {
    await new RemotarScraperProvider(http, 2).scrape();

    expect(http.requestedUrls).toEqual([
      'https://api.remotar.com.br/jobs?page=1',
      'https://api.remotar.com.br/jobs?page=2',
    ]);
  });

  it('normaliza as vagas da api', async () => {
    const jobs = await provider.scrape();

    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      title: 'Consultor SAP MM Sênior',
      company: 'EcomIT',
      source: 'remotar',
      workModel: 'REMOTE',
      location: 'Remoto',
      publishedAtSource: 'SOURCE',
    });
    expect(jobs[0]?.publishedAt?.toISOString()).toBe('2026-10-26T15:14:00.171Z');
  });

  it('usa o link externo quando a vaga e intermediada', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]?.url).toContain('inhire.app');
  });

  it('monta a url canonica do Remotar quando a vaga nao e externa', async () => {
    const provider = new RemotarScraperProvider(
      new FakeHttpClient(() => ({ data: [job({ isExternalLink: false, id: 777 })] })),
      1,
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.url).toBe('https://remotar.com.br/vaga/777');
  });

  it('aceita identificador em texto', async () => {
    const provider = new RemotarScraperProvider(
      new FakeHttpClient(() => ({ data: [job({ isExternalLink: false, id: ' abc-1 ' })] })),
      1,
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.url).toBe('https://remotar.com.br/vaga/abc-1');
  });

  it('extrai as tags da vaga', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]?.tags).toEqual(['🤝🏽 PJ', '🧓🏽 Sênior', '🌍 100% Remoto']);
  });

  it('monta a localidade com cidade e estado quando informados', async () => {
    const provider = new RemotarScraperProvider(
      new FakeHttpClient(() => ({
        data: [job({ city: 'Salvador', state: 'BA', type: 'hybrid' })],
      })),
      1,
    );

    const jobs = await provider.scrape();

    expect(jobs[0]).toMatchObject({ location: 'Salvador - BA', workModel: 'HYBRID' });
  });

  it.each([
    ['remote', 'REMOTE'],
    ['hybrid', 'HYBRID'],
    ['presential', 'ONSITE'],
    ['onsite', 'ONSITE'],
    ['freelance', 'UNKNOWN'],
  ])('traduz o tipo "%s" em %s', async (type, expected) => {
    const provider = new RemotarScraperProvider(
      new FakeHttpClient(() => ({ data: [job({ type })] })),
      1,
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.workModel).toBe(expected);
  });

  it('deixa a localidade vazia quando nao e remota nem tem cidade', async () => {
    const provider = new RemotarScraperProvider(
      new FakeHttpClient(() => ({ data: [job({ type: 'freelance' })] })),
      1,
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.location).toBe('');
  });

  it.each([
    ['expirada', { expired: true }],
    ['inativa', { active: false }],
  ])('descarta vaga %s', async (_label, overrides) => {
    const provider = new RemotarScraperProvider(
      new FakeHttpClient(() => ({ data: [job(overrides)] })),
      1,
    );

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it.each([
    ['sem titulo', { title: '' }],
    ['sem empresa', { company: null, companyDisplayName: null }],
    ['sem id nem link externo', { isExternalLink: false, id: null }],
    ['com data invalida', { createdAt: 'ontem' }],
  ])('descarta vaga %s', async (_label, overrides) => {
    const provider = new RemotarScraperProvider(
      new FakeHttpClient(() => ({ data: [job(overrides)] })),
      1,
    );

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('cai para companyDisplayName quando o objeto company nao vem', async () => {
    const provider = new RemotarScraperProvider(
      new FakeHttpClient(() => ({
        data: [job({ company: null, companyDisplayName: 'Acme Corp' })],
      })),
      1,
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.company).toBe('Acme Corp');
  });

  it('usa o autor da publicacao como recrutador quando informado', async () => {
    const provider = new RemotarScraperProvider(
      new FakeHttpClient(() => ({ data: [job({ author: { name: 'Ana Recrutadora' } })] })),
      1,
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.recruiterName).toBe('Ana Recrutadora');
  });

  it.each([
    ['resposta sem data', { meta: {} }],
    ['resposta nula', null],
    ['data em formato inesperado', { data: 'nope' }],
  ])('devolve lista vazia para %s', async (_label, body) => {
    const provider = new RemotarScraperProvider(new FakeHttpClient(() => body), 1);

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando a fonte falha, sem propagar excecao', async () => {
    const provider = new RemotarScraperProvider(failingHttpClient(), 1);

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('consulta duas paginas por padrao', async () => {
    await new RemotarScraperProvider(http).scrape();

    expect(http.requestedUrls).toHaveLength(2);
  });
});

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    title: 'Dev Frontend React',
    subtitle: 'Vaga remota',
    description: '<p>React e TypeScript</p>',
    city: null,
    state: null,
    type: 'remote',
    expired: false,
    active: true,
    externalLink: 'https://acme.inhire.app/vagas/1',
    isExternalLink: true,
    createdAt: '2026-10-26T12:00:00.000-03:00',
    company: { id: 1, name: 'Acme Corp' },
    author: null,
    jobTags: [{ tag: { name: '🌍 100% Remoto' } }],
    ...overrides,
  };
}
