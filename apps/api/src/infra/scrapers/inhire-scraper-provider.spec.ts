import { beforeEach, describe, expect, it } from 'vitest';

import {
  INHIRE_DEFAULT_TENANTS,
  INHIRE_MAX_DETAILS_PER_CYCLE,
  INHIRE_REQUEST_DELAY_IN_MS,
  InhireScraperProvider,
  inhireTenantsFromEnv,
} from '@/infra/scrapers/inhire-scraper-provider';
import type { InhireTenantDiscovery } from '@/infra/scrapers/support/inhire-tenant-discovery';
import {
  FakeHttpClient,
  failingHttpClient,
  readJsonFixture,
} from '../../../test/factories/fake-http-client';

const LISTING = readJsonFixture<Record<string, unknown>>('inhire-jobs.json');
const DETAIL = readJsonFixture<Record<string, unknown>>('inhire-job-detail.json');

const LISTING_URL = 'https://api.inhire.app/job-posts/public/pages';

const FULLSTACK_ID = '8aaac374-e518-4ec2-b3e4-959792fdb7a5';
const FRONTEND_ID = '507573b4-3b2f-4a89-ae05-9049bca43fbf';
const BACKEND_ID = 'e1304000-a92e-4ab7-a61a-956d4a6eb13e';

/** Responde a lista para a url de pagina e o detalhe para a url com id. */
function respondWith(detail: unknown = DETAIL): (url: string) => unknown {
  return (url) => (url === LISTING_URL ? LISTING : detail);
}

function detailUrls(http: FakeHttpClient): string[] {
  return http.requestedUrls.filter((url) => url !== LISTING_URL);
}

function listing(entries: readonly Record<string, unknown>[]): unknown {
  return { tenantName: 'Sympla', jobsPage: entries };
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: 'Desenvolvedor Fullstack Pleno',
    jobId: FULLSTACK_ID,
    status: 'published',
    workplaceType: 'Remote',
    location: 'BR',
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...DETAIL, ...overrides };
}

describe('InhireScraperProvider', () => {
  let http: FakeHttpClient;
  let waited: number[];
  let provider: InhireScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(respondWith());
    waited = [];
    provider = new InhireScraperProvider(http, ['sympla'], async (ms) => {
      waited.push(ms);
    });
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('inhire');
    expect(provider.label).toBe('InHire');
  });

  it('consulta a api publica de cada tenant pelo cabecalho X-Tenant', async () => {
    const dois = new InhireScraperProvider(http, ['sympla', 'dock'], async () => {});

    await dois.scrape();

    const listas = http.requests.filter((request) => request.url === LISTING_URL);
    expect(listas).toHaveLength(2);
    expect(listas.map((request) => request.options?.headers?.['X-Tenant'])).toEqual([
      'sympla',
      'dock',
    ]);
  });

  /**
   * A lista nao traz data de publicacao, so o detalhe — e sao 410 vagas somadas
   * nos tenants semente. O recorte por cargo e o que mantem o ciclo viavel.
   */
  it('busca o detalhe apenas dos cargos de desenvolvimento', async () => {
    await provider.scrape();

    expect(detailUrls(http)).toEqual([
      `${LISTING_URL}/${FULLSTACK_ID}`,
      `${LISTING_URL}/${FRONTEND_ID}`,
      `${LISTING_URL}/${BACKEND_ID}`,
    ]);
  });

  it('normaliza a vaga com os dados do detalhe', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]).toMatchObject({
      title: 'Pessoa Desenvolvedora Full Stack Sênior (Gandaya) | Remoto',
      company: 'Sympla',
      source: 'inhire',
      url: `https://sympla.inhire.app/vagas/${FULLSTACK_ID}`,
      workModel: 'REMOTE',
      location: 'Remoto',
      publishedAtSource: 'SOURCE',
    });
    expect(jobs[0]?.publishedAt?.toISOString()).toBe('2026-10-27T12:30:55.367Z');
  });

  it('converte a descricao em html para texto corrido', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]?.description).toContain('Experiência sólida com React');
    // Entidade resolvida (`&ccedil;`, `&atilde;`) e um item de lista por linha.
    expect(jobs[0]?.description).toContain('construção de funcionalidades');
    expect(jobs[0]?.description).not.toContain('<p>');
    expect(jobs[0]?.description?.split('\n\n').length).toBeGreaterThan(3);
  });

  it.each([
    ['Remote', 'REMOTE'],
    ['Hybrid', 'HYBRID'],
    ['On-site', 'ONSITE'],
    ['', 'UNKNOWN'],
  ])('traduz a modalidade estruturada %s em %s', async (workplaceType, expected) => {
    const provider = new InhireScraperProvider(
      new FakeHttpClient((url) =>
        url === LISTING_URL ? listing([entry()]) : detail({ workplaceType }),
      ),
      ['sympla'],
      async () => {},
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.workModel).toBe(expected);
  });

  it('tira o pais do fim da localidade e junta o complemento', async () => {
    const provider = new InhireScraperProvider(
      new FakeHttpClient((url) =>
        url === LISTING_URL
          ? listing([entry()])
          : detail({
              workplaceType: 'Hybrid',
              location: 'Salvador, BA, BR',
              locationComplement: 'Caminho das Árvores',
            }),
      ),
      ['sympla'],
      async () => {},
    );

    const jobs = await provider.scrape();

    expect(jobs[0]?.location).toBe('Salvador, BA - Caminho das Árvores');
  });

  it('nao gasta requisicao de detalhe com vaga que nao esta publicada', async () => {
    const rascunho = new FakeHttpClient((url) =>
      url === LISTING_URL ? listing([entry({ status: 'draft' })]) : DETAIL,
    );

    const jobs = await new InhireScraperProvider(rascunho, ['sympla'], async () => {}).scrape();

    expect(jobs).toEqual([]);
    expect(detailUrls(rascunho)).toEqual([]);
  });

  it('descarta a vaga cujo detalhe nao informa data', async () => {
    const provider = new InhireScraperProvider(
      new FakeHttpClient((url) =>
        url === LISTING_URL
          ? listing([entry()])
          : { ...DETAIL, publishedAt: null, createdAt: null },
      ),
      ['sympla'],
      async () => {},
    );

    expect(await provider.scrape()).toEqual([]);
  });

  it('espera entre as requisicoes, menos antes da primeira', async () => {
    await provider.scrape();

    // 1 lista + 3 detalhes = 4 requisicoes, logo 3 esperas.
    expect(waited).toEqual([
      INHIRE_REQUEST_DELAY_IN_MS,
      INHIRE_REQUEST_DELAY_IN_MS,
      INHIRE_REQUEST_DELAY_IN_MS,
    ]);
  });

  it('respeita o teto de detalhes por ciclo', async () => {
    const provider = new InhireScraperProvider(http, ['sympla'], async () => {}, 2);

    const jobs = await provider.scrape();

    expect(detailUrls(http)).toHaveLength(2);
    expect(jobs).toHaveLength(2);
  });

  it('nao repete a mesma vaga quando dois tenants a anunciam', async () => {
    const provider = new InhireScraperProvider(
      new FakeHttpClient((url) => (url === LISTING_URL ? listing([entry(), entry()]) : DETAIL)),
      ['sympla'],
      async () => {},
    );

    expect(await provider.scrape()).toHaveLength(1);
  });

  it('segue para os demais tenants quando um deles responde erro', async () => {
    let chamadas = 0;
    const http = new FakeHttpClient((url) => {
      if (url !== LISTING_URL) {
        return DETAIL;
      }

      chamadas += 1;

      return chamadas === 1 ? new Error('404 tenant nao encontrado') : listing([entry()]);
    });

    const jobs = await new InhireScraperProvider(http, ['sumiu', 'sympla'], async () => {}).scrape();

    expect(jobs).toHaveLength(1);
  });

  it('ignora a vaga cujo detalhe falha, sem derrubar o ciclo', async () => {
    const http = new FakeHttpClient((url) =>
      url === LISTING_URL ? LISTING : new Error('429 Too Many Requests'),
    );

    expect(await new InhireScraperProvider(http, ['sympla'], async () => {}).scrape()).toEqual([]);
  });

  it('nao propaga excecao quando a fonte esta fora do ar', async () => {
    const provider = new InhireScraperProvider(failingHttpClient(), ['sympla'], async () => {});

    expect(await provider.scrape()).toEqual([]);
  });

  describe('tenants descobertos no banco', () => {
    function discoveryOf(tenants: readonly string[]): InhireTenantDiscovery {
      return { discover: async () => tenants } as InhireTenantDiscovery;
    }

    function tenantsOf(client: FakeHttpClient): (string | undefined)[] {
      return client.requests
        .filter((request) => request.url === LISTING_URL)
        .map((request) => request.options?.headers?.['X-Tenant']);
    }

    it('varre o tenant descoberto junto com a semente', async () => {
      const provider = new InhireScraperProvider(
        http,
        ['sympla'],
        async () => {},
        INHIRE_MAX_DETAILS_PER_CYCLE,
        discoveryOf(['novatech']),
      );

      await provider.scrape();

      expect(tenantsOf(http)).toEqual(['sympla', 'novatech']);
    });

    it('nao varre duas vezes o tenant que a semente ja tinha', async () => {
      const provider = new InhireScraperProvider(
        http,
        ['sympla', 'dock'],
        async () => {},
        INHIRE_MAX_DETAILS_PER_CYCLE,
        discoveryOf(['dock', 'novatech']),
      );

      await provider.scrape();

      expect(tenantsOf(http)).toEqual(['sympla', 'dock', 'novatech']);
    });

    it('mantem a cadencia de 1,5s nas requisicoes do tenant descoberto', async () => {
      const provider = new InhireScraperProvider(
        http,
        ['sympla'],
        async (ms) => {
          waited.push(ms);
        },
        INHIRE_MAX_DETAILS_PER_CYCLE,
        discoveryOf(['novatech']),
      );

      await provider.scrape();

      // Duas listas e os detalhes de ambas, todos na mesma fila: so a primeira
      // requisicao do ciclo sai sem espera.
      expect(waited.length).toBe(tenantsOf(http).length + detailUrls(http).length - 1);
      expect(new Set(waited)).toEqual(new Set([INHIRE_REQUEST_DELAY_IN_MS]));
    });

    it('segue so com a semente quando nada foi descoberto', async () => {
      const provider = new InhireScraperProvider(
        http,
        ['sympla'],
        async () => {},
        INHIRE_MAX_DETAILS_PER_CYCLE,
        discoveryOf([]),
      );

      await provider.scrape();

      expect(tenantsOf(http)).toEqual(['sympla']);
    });
  });

  describe('inhireTenantsFromEnv', () => {
    it('usa a lista semente quando a variavel nao esta definida', () => {
      expect(inhireTenantsFromEnv({})).toEqual(INHIRE_DEFAULT_TENANTS);
    });

    it('le os tenants da variavel, normalizando e sem repetir', () => {
      const tenants = inhireTenantsFromEnv({ INHIRE_TENANTS: ' Sympla , dock,sympla, ' });

      expect(tenants).toEqual(['sympla', 'dock']);
    });

    it('descarta valor que nao e um subdominio valido', () => {
      expect(inhireTenantsFromEnv({ INHIRE_TENANTS: 'sympla, http://x.inhire.app, a' })).toEqual([
        'sympla',
      ]);
    });

    it('cai na lista semente quando a variavel so tem valor invalido', () => {
      expect(inhireTenantsFromEnv({ INHIRE_TENANTS: '  , ,' })).toEqual(INHIRE_DEFAULT_TENANTS);
    });
  });
});
