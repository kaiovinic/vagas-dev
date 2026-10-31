import { beforeEach, describe, expect, it } from 'vitest';

import {
  LINKEDIN_DEFAULT_SEARCHES,
  LINKEDIN_LAST_72H_FILTER,
  LINKEDIN_MAX_CARDS_PER_SEARCH,
  LINKEDIN_PAGE_SIZE,
  LINKEDIN_REQUEST_DELAY_IN_MS,
  LinkedinGuestScraperProvider,
  type LinkedinSearch,
} from '@/infra/scrapers/linkedin-guest-scraper-provider';
import type { IHttpClient } from '@/domain/providers/http-client';
import {
  InMemoryJobDescriptionWriter,
  StubJobDescriptionReader,
} from '../../../test/factories/doubles';
import {
  FakeHttpClient,
  failingHttpClient,
  readFixture,
} from '../../../test/factories/fake-http-client';

const FIXTURE = readFixture('linkedin-guest-jobs.html');
const DETAIL_FIXTURE = readFixture('linkedin-guest-job-detail.html');

/** Roteia como o LinkedIn: a busca devolve cards, o detalhe devolve a descricao. */
function respondLikeLinkedin(url: string): string {
  return url.includes('/jobPosting/') ? DETAIL_FIXTURE : FIXTURE;
}

const isSearch = (url: string): boolean => url.includes('seeMoreJobPostings');

const SALVADOR_SEARCH = {
  keywords: 'desenvolvedor frontend',
  location: 'Bahia, Brazil',
  remoteOnly: false,
};

describe('LinkedinGuestScraperProvider', () => {
  let http: FakeHttpClient;
  let descriptions: StubJobDescriptionReader;
  let cache: InMemoryJobDescriptionWriter;
  let provider: LinkedinGuestScraperProvider;
  /** Quanto o coletor pediu para esperar, em vez de esperar de verdade. */
  let waits: number[];

  function makeProvider(
    client: IHttpClient = http,
    searches: readonly LinkedinSearch[] = [SALVADOR_SEARCH],
  ): LinkedinGuestScraperProvider {
    return new LinkedinGuestScraperProvider(client, descriptions, cache, searches, async (ms) => {
      waits.push(ms);
    });
  }

  beforeEach(() => {
    http = new FakeHttpClient(respondLikeLinkedin);
    descriptions = new StubJobDescriptionReader();
    cache = new InMemoryJobDescriptionWriter();
    waits = [];
    provider = makeProvider();
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
    expect(url).toContain('location=Bahia%2C+Brazil');
    expect(url).toContain('f_TPR=r259200');
    expect(url).not.toContain('f_WT');
  });

  it('aplica f_WT=2 nas buscas de vagas remotas', async () => {
    const remote = makeProvider(http, [{ keywords: 'react', location: 'Brazil', remoteOnly: true }]);

    await remote.scrape();

    expect(http.requestedUrls[0]).toContain('f_WT=2');
  });

  it('cobre a Bahia e Remoto para cada palavra-chave padrao', () => {
    expect(LINKEDIN_DEFAULT_SEARCHES.filter((search) => search.remoteOnly)).toHaveLength(
      LINKEDIN_DEFAULT_SEARCHES.length / 2,
    );
    expect(
      LINKEDIN_DEFAULT_SEARCHES.some(
        (search) => search.location === 'Bahia, Brazil' && !search.remoteOnly,
      ),
    ).toBe(true);
  });

  it('extrai os cards de vaga do html guest', async () => {
    const jobs = await provider.scrape();

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      title: 'Desenvolvedor Front-end Júnior',
      company: 'Jobbol',
      // Vem do HTML da fixture, e nao da busca: e o que a vaga anuncia.
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

  describe('modalidade na busca com f_WT=2', () => {
    /**
     * A fixture e a resposta real dessa busca: o LinkedIn ignora o `f_WT` para
     * visitantes e devolve vaga presencial de outro estado junto das remotas.
     * Confirmado em 31/10/2026 comparando a mesma consulta com e sem o
     * parametro — os ids voltaram identicos.
     */
    let remote: LinkedinGuestScraperProvider;

    beforeEach(() => {
      remote = makeProvider(
        new FakeHttpClient((url) =>
          url.includes('/jobPosting/')
            ? DETAIL_FIXTURE
            : readFixture('linkedin-guest-jobs-remote.html'),
        ),
        [{ keywords: 'desenvolvedor frontend', location: 'Brazil', remoteOnly: true }],
      );
    });

    it('nao marca como remota a vaga presencial de outro estado', async () => {
      const jobs = await remote.scrape();
      const jaguariuna = jobs.find((job) => job.location === 'Jaguariuna, SP');

      // Marcada como REMOTE, ela ganharia o rotulo "Remoto" no motor de regras
      // e pularia a regra de localidade inteira — inclusive a da Bahia.
      expect(jaguariuna?.workModel).not.toBe('REMOTE');
    });

    it('reconhece a vaga remota anunciada no titulo', async () => {
      const jobs = await remote.scrape();
      const contoso = jobs.find((job) => job.company === 'Contoso');

      expect(contoso?.workModel).toBe('REMOTE');
    });

    it('deixa em UNKNOWN a vaga sem sinal de modalidade', async () => {
      const jobs = await remote.scrape();
      const fabrikam = jobs.find((job) => job.company === 'Fabrikam');

      expect(fabrikam?.workModel).toBe('UNKNOWN');
    });
  });

  it('deriva a modalidade do titulo e da localidade, nao do filtro da busca', async () => {
    const jobs = await provider.scrape();

    // A segunda vaga da fixture e "Senior Software Engineer (.NET + Vue) -
    // Remote - Latin America": a modalidade esta no titulo, e a localidade
    // ("Salvador, Bahia, Brazil") nao diz nada sobre ela. A primeira nao tem
    // sinal nenhum e fica em UNKNOWN, que e o honesto.
    expect(jobs.map((job) => job.workModel)).toEqual(['UNKNOWN', 'REMOTE']);
  });

  it('deduplica a mesma vaga encontrada em buscas diferentes', async () => {
    const twice = makeProvider(http, [SALVADOR_SEARCH, { ...SALVADOR_SEARCH, keywords: 'react' }]);

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
    const provider = makeProvider(new FakeHttpClient(() => html));

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando o html nao tem cards', async () => {
    const provider = makeProvider(new FakeHttpClient(() => '<html><body></body></html>'));

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando a fonte falha, sem propagar excecao', async () => {
    const provider = makeProvider(failingHttpClient());

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  describe('paginacao da busca', () => {
    const PAGE_1 = readFixture('linkedin-guest-jobs-page-1.html');
    const PAGE_2 = readFixture('linkedin-guest-jobs-page-2.html');

    const startOf = (url: string): string => new URL(url).searchParams.get('start') ?? '';
    const searchStarts = (client: FakeHttpClient): string[] =>
      client.requestedUrls.filter(isSearch).map(startOf);

    /** Responde a pagina real de dez cards enquanto o `start` for menor que `ate`. */
    function respondUntil(ate: number): (url: string) => string {
      return (url) => {
        if (!isSearch(url)) {
          return DETAIL_FIXTURE;
        }

        return Number(startOf(url)) < ate ? PAGE_1 : PAGE_2;
      };
    }

    it('anda de dez em dez a partir de zero', async () => {
      const client = new FakeHttpClient(respondUntil(30));
      const provider = makeProvider(client);

      await provider.scrape();

      expect(searchStarts(client)).toEqual(['0', '10', '20', '30']);
    });

    it('para na primeira pagina incompleta', async () => {
      const client = new FakeHttpClient(respondUntil(10));
      const provider = makeProvider(client);

      await provider.scrape();

      // A pagina de `start=10` volta com tres cards: nao existe a de 20.
      expect(searchStarts(client)).toEqual(['0', '10']);
    });

    it('nao busca pagina nenhuma alem do teto da busca', async () => {
      const client = new FakeHttpClient((url) => (isSearch(url) ? PAGE_1 : DETAIL_FIXTURE));
      const provider = makeProvider(client, [{ ...SALVADOR_SEARCH, maxCards: 20 }]);

      await provider.scrape();

      // Toda pagina vem cheia; so o teto encerra a busca.
      expect(searchStarts(client)).toEqual(['0', '10']);
    });

    it('usa o teto do coletor quando a busca nao define o proprio', async () => {
      const client = new FakeHttpClient((url) => (isSearch(url) ? PAGE_1 : DETAIL_FIXTURE));
      const provider = new LinkedinGuestScraperProvider(
        client,
        descriptions,
        cache,
        [SALVADOR_SEARCH],
        async () => {},
        0,
        20,
      );

      await provider.scrape();

      expect(searchStarts(client)).toEqual(['0', '10']);
    });

    it('junta as vagas de todas as paginas', async () => {
      const client = new FakeHttpClient(respondUntil(10));
      const provider = makeProvider(client);

      const jobs = await provider.scrape();

      // Dez cards na primeira pagina, tres na segunda, sem repetir url.
      expect(jobs).toHaveLength(13);
      expect(new Set(jobs.map((job) => job.url)).size).toBe(13);
    });

    it('espera entre uma pagina e a seguinte', async () => {
      const provider = makeProvider(new FakeHttpClient(respondUntil(10)));

      await provider.scrape();

      // Duas paginas de busca e treze detalhes: quinze requisicoes, catorze
      // esperas. Nenhuma saiu em rajada, e a primeira nao esperou.
      expect(waits.every((ms) => ms === LINKEDIN_REQUEST_DELAY_IN_MS)).toBe(true);
      expect(waits).toHaveLength(14);
    });

    it('nao paralela as buscas: as paginas de uma saem antes da proxima', async () => {
      const client = new FakeHttpClient(respondUntil(10));
      const provider = makeProvider(client, [
        SALVADOR_SEARCH,
        { ...SALVADOR_SEARCH, keywords: 'react' },
      ]);

      await provider.scrape();

      const buscas = client.requestedUrls.filter(isSearch);

      expect(buscas.map((url) => new URL(url).searchParams.get('keywords'))).toEqual([
        'desenvolvedor frontend',
        'desenvolvedor frontend',
        'react',
        'react',
      ]);
    });

    it('mantem o teto padrao em quatro paginas por busca', () => {
      expect(LINKEDIN_MAX_CARDS_PER_SEARCH / LINKEDIN_PAGE_SIZE).toBe(4);
    });
  });

  describe('descricao completa', () => {
    const detailUrls = (client: FakeHttpClient): string[] =>
      client.requestedUrls.filter((url) => url.includes('/jobPosting/'));

    it('busca o detalhe de cada vaga e usa o texto como descricao', async () => {
      const jobs = await provider.scrape();

      expect(detailUrls(http)).toEqual([
        'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4482768114',
        'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4466397472',
      ]);
      expect(jobs[0]?.description).toContain('Senior React.js Developer');
      expect(jobs[0]?.description).toContain('Feira de Santana');
    });

    it('preserva as quebras de linha das listas do anuncio', async () => {
      const [job] = await provider.scrape();

      // O corpo vira texto, nao uma linha so: a descricao tambem e exibida no
      // painel, e sem as quebras os itens da lista grudam uns nos outros.
      expect(job?.description).toContain('\nDesenvolver aplicações com React.js e TypeScript.');
    });

    it('nao busca o detalhe de vaga cuja descricao ja esta no banco', async () => {
      descriptions.stored.set(
        'https://br.linkedin.com/jobs/view/desenvolvedor-front-end-j%C3%BAnior-at-jobbol-4482768114',
        'descricao ja capturada em um ciclo anterior',
      );

      const jobs = await provider.scrape();

      expect(detailUrls(http)).toEqual([
        'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4466397472',
      ]);
      expect(jobs[0]?.description).toBe('descricao ja capturada em um ciclo anterior');
    });

    it('pergunta ao cache pelas urls das vagas encontradas', async () => {
      await provider.scrape();

      expect(descriptions.asked).toHaveLength(1);
      expect(descriptions.asked[0]).toHaveLength(2);
    });

    it('espera entre as requisicoes do ciclo, menos antes da primeira', async () => {
      await provider.scrape();

      // Uma pagina de busca e dois detalhes: tres requisicoes, duas esperas.
      expect(waits).toEqual([LINKEDIN_REQUEST_DELAY_IN_MS, LINKEDIN_REQUEST_DELAY_IN_MS]);
    });

    it('guarda no cache o que buscou, para nao gastar o teto de novo', async () => {
      await provider.scrape();

      // O cache e alimentado ANTES de as regras julgarem a vaga: a maioria dos
      // cards e reprovada e nunca chega a tabela de vagas, e sem isto o teto de
      // detalhes era gasto nos mesmos reprovados a cada ciclo.
      expect([...cache.saved.values()].every((texto) => texto.length > 0)).toBe(true);
      expect(cache.saved.size).toBe(detailUrls(http).length);
    });

    it('nao escreve no cache quando nenhum detalhe veio', async () => {
      const semBloco = makeProvider(
        new FakeHttpClient((url) => (isSearch(url) ? FIXTURE : '<html><body>oi</body></html>')),
      );

      await semBloco.scrape();

      expect(cache.saved.size).toBe(0);
    });

    it('nao busca de novo o que o cache ja guardou num ciclo anterior', async () => {
      await provider.scrape();
      const primeiroCiclo = detailUrls(http).length;

      // O ciclo seguinte ve pelo leitor o que o ciclo anterior gravou.
      for (const [url, texto] of cache.saved) {
        descriptions.stored.set(url, texto);
      }
      await makeProvider().scrape();

      expect(detailUrls(http)).toHaveLength(primeiroCiclo);
    });

    it('nao derruba a coleta quando a escrita do cache falha', async () => {
      cache.failWith = new Error('connection refused');

      const jobs = await provider.scrape();

      expect(jobs).toHaveLength(2);
      expect(jobs[1]?.description).toContain('Senior React.js Developer');
    });

    it('respeita o teto de detalhes por ciclo', async () => {
      const limited = new LinkedinGuestScraperProvider(
        http,
        descriptions,
        cache,
        [SALVADOR_SEARCH],
        async () => {},
        1,
      );

      const jobs = await limited.scrape();

      // A vaga que ficou de fora volta sem descricao e e tentada no proximo
      // ciclo, quando o cache ja tiver a primeira.
      expect(detailUrls(http)).toHaveLength(1);
      expect(jobs[1]?.description).toBe('');
    });

    it('segue com as demais vagas quando um detalhe falha', async () => {
      const flaky = makeProvider(
        new FakeHttpClient((url) => {
          if (!isSearch(url)) {
            return url.endsWith('4482768114') ? new Error('HTTP 429') : DETAIL_FIXTURE;
          }

          return FIXTURE;
        }),
      );

      const jobs = await flaky.scrape();

      expect(jobs).toHaveLength(2);
      expect(jobs[0]?.description).toBe('');
      expect(jobs[1]?.description).toContain('Senior React.js Developer');
    });

    it('deixa a descricao vazia quando a pagina de detalhe nao tem o bloco', async () => {
      const semBloco = makeProvider(
        new FakeHttpClient((url) => (isSearch(url) ? FIXTURE : '<html><body>oi</body></html>')),
      );

      const [job] = await semBloco.scrape();

      expect(job?.description).toBe('');
    });
  });

  it('usa as buscas padrao quando nenhuma e informada', async () => {
    const provider = new LinkedinGuestScraperProvider(
      http,
      descriptions,
      cache,
      undefined,
      async () => {},
    );

    await provider.scrape();

    // A fixture tem seis cards, menos que uma pagina cheia: uma requisicao por
    // busca, sem paginacao.
    expect(http.requestedUrls.filter(isSearch)).toHaveLength(LINKEDIN_DEFAULT_SEARCHES.length);
  });
});
