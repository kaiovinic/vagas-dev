import { beforeEach, describe, expect, it } from 'vitest';

import {
  PROGRAMATHOR_DEFAULT_CATEGORIES,
  PROGRAMATHOR_REQUEST_DELAY_IN_MS,
  ProgramathorScraperProvider,
} from '@/infra/scrapers/programathor-scraper-provider';
import {
  FakeHttpClient,
  failingHttpClient,
  readFixture,
} from '../../../test/factories/fake-http-client';

const FIXTURE = readFixture('programathor-jobs.html');
const DETAIL_FIXTURE = readFixture('programathor-job-detail.html');

describe('ProgramathorScraperProvider', () => {
  let http: FakeHttpClient;
  let provider: ProgramathorScraperProvider;

  beforeEach(() => {
    http = new FakeHttpClient(() => FIXTURE);
    provider = new ProgramathorScraperProvider(http, ['jobs-front-end']);
  });

  it('identifica a fonte', () => {
    expect(provider.source).toBe('programathor');
    expect(provider.label).toBe('ProgramaThor');
  });

  it('consulta uma pagina por categoria configurada', async () => {
    await new ProgramathorScraperProvider(http, ['jobs-front-end', 'jobs-react']).scrape();

    expect(http.requestedUrls).toEqual([
      'https://programathor.com.br/jobs-front-end',
      'https://programathor.com.br/jobs-react',
    ]);
  });

  it('nao inclui categoria de fullstack, que nao existe no site', () => {
    expect(PROGRAMATHOR_DEFAULT_CATEGORIES).toEqual([
      'jobs-front-end',
      'jobs-react',
      'jobs-node-js',
      'jobs-angular',
      'jobs-net',
    ]);
  });

  it('descarta os cards marcados como vencidos', async () => {
    const jobs = await provider.scrape();

    expect(jobs).toHaveLength(1);
  });

  it('extrai titulo, empresa, localidade e url do card ativo', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]).toMatchObject({
      title: 'Desenvolvedor(a) Front-End Pleno',
      company: 'Syndata Sistemas',
      source: 'programathor',
      url: 'https://programathor.com.br/jobs/33833-desenvolvedor-a-front-end-pleno',
      workModel: 'ONSITE',
    });
    expect(jobs[0]?.location).toContain('GOIÂNIA');
  });

  it('remove as badges do titulo', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]?.title).not.toContain('PRESENCIAL');
  });

  it('extrai as tecnologias como tags', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]?.tags).toEqual(
      expect.arrayContaining(['TypeScript', 'ReactJS', 'JavaScript', 'CSS']),
    );
  });

  it('marca a data como estimada na captura, porque a fonte nao publica data', async () => {
    const jobs = await provider.scrape();

    expect(jobs[0]?.publishedAtSource).toBe('CAPTURE');
    expect(jobs[0]?.publishedAt).toBeUndefined();
  });

  it('deduplica a mesma vaga listada em duas categorias', async () => {
    const jobs = await new ProgramathorScraperProvider(http, [
      'jobs-front-end',
      'jobs-react',
    ]).scrape();

    expect(jobs).toHaveLength(1);
  });

  it('deriva a modalidade do rotulo de localidade', async () => {
    const remote = card({ location: 'Qualquer lugar (Remoto)' });
    const provider = new ProgramathorScraperProvider(new FakeHttpClient(() => remote), [
      'jobs-front-end',
    ]);

    const jobs = await provider.scrape();

    expect(jobs[0]?.workModel).toBe('REMOTE');
  });

  it.each([
    ['sem titulo', card({ title: '' })],
    ['sem empresa', card({ company: '' })],
    ['sem link de vaga', card({ href: '' })],
    ['sem h3', '<div class="cell-list"><a href="/jobs/1-dev"></a></div>'],
  ])('descarta card %s', async (_label, html) => {
    const provider = new ProgramathorScraperProvider(new FakeHttpClient(() => html), [
      'jobs-front-end',
    ]);

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('descarta card com badge "Vencida" mesmo sem a classe de opacidade', async () => {
    const html =
      '<div class="cell-list"><a href="/jobs/1-dev">' +
      '<h3><span>Vencida</span> Dev Frontend</h3>' +
      '<div class="cell-list-content-icon"><span>Acme</span><span>Salvador (Remoto)</span></div>' +
      '</a></div>';
    const provider = new ProgramathorScraperProvider(new FakeHttpClient(() => html), [
      'jobs-front-end',
    ]);

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando o html nao tem cards', async () => {
    const provider = new ProgramathorScraperProvider(
      new FakeHttpClient(() => '<html><body></body></html>'),
      ['jobs-front-end'],
    );

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('devolve lista vazia quando a fonte falha, sem propagar excecao', async () => {
    const provider = new ProgramathorScraperProvider(failingHttpClient(), ['jobs-front-end']);

    await expect(provider.scrape()).resolves.toEqual([]);
  });

  it('usa as categorias padrao quando nenhuma e informada', async () => {
    await new ProgramathorScraperProvider(http).scrape();

    expect(http.requestedUrls).toHaveLength(PROGRAMATHOR_DEFAULT_CATEGORIES.length);
  });
  describe('descricao pela url', () => {
    const VAGA = 'https://programathor.com.br/jobs/33840-desenvolvedor-a-full-stack-pleno';

    /** Quanto o coletor pediu para esperar, em vez de esperar de verdade. */
    let waits: number[];
    let detalhe: ProgramathorScraperProvider;

    beforeEach(() => {
      waits = [];
      http = new FakeHttpClient(() => DETAIL_FIXTURE);
      detalhe = new ProgramathorScraperProvider(http, ['jobs-front-end'], async (ms) => {
        waits.push(ms);
      });
    });

    it('busca a propria pagina da vaga', async () => {
      await detalhe.fetchDescriptionFor(VAGA);

      expect(http.requestedUrls).toEqual([VAGA]);
    });

    it('le o anuncio inteiro, titulo por titulo', async () => {
      const texto = await detalhe.fetchDescriptionFor(VAGA);

      expect(texto).toContain('Descrição da empresa');
      expect(texto).toContain('Atividades e Responsabilidades');
      expect(texto).toContain('Requisitos');
      expect(texto).toContain('R$ 55,00 / hora');
    });

    it('mantem uma linha por item, para o painel exibir a lista legivel', async () => {
      const texto = await detalhe.fetchDescriptionFor(VAGA);

      expect(texto).toContain(
        [
          '- 3 a 5 anos com desenvolvimento fullstack, com backend em C#/.NET (Core / 6+)',
          '- APIs REST com ASP.NET Core, EF Core e/ou Dapper',
        ].join('\n'),
      );
    });

    it('resolve as entidades do HTML', async () => {
      const texto = await detalhe.fetchDescriptionFor(VAGA);

      expect(texto).toContain('BPO especializado & gestão operacional');
      expect(texto).not.toContain('&amp;');
    });

    it('nao traz marcacao nenhuma', async () => {
      const texto = await detalhe.fetchDescriptionFor(VAGA);

      expect(texto).not.toContain('<');
    });

    it('descarta o anuncio do Google que fica dentro do bloco', async () => {
      const texto = await detalhe.fetchDescriptionFor(VAGA);

      expect(texto).not.toContain('adsbygoogle');
    });

    it('para no fim do anuncio: barra lateral e rodape ficam fora', async () => {
      const texto = await detalhe.fetchDescriptionFor(VAGA);

      expect(texto).not.toContain('Veja vagas similares');
      expect(texto).not.toContain('Quero me candidatar');
      expect(texto).not.toContain('Seu perfil combina');
    });

    it('espera antes de pedir, para nao somar rajada a fonte', async () => {
      await detalhe.fetchDescriptionFor(VAGA);

      expect(waits).toEqual([PROGRAMATHOR_REQUEST_DELAY_IN_MS]);
    });

    it('devolve vazio quando a pagina nao tem o bloco do anuncio', async () => {
      const semBloco = new ProgramathorScraperProvider(
        new FakeHttpClient(() => '<html><body><h1>Vaga removida</h1></body></html>'),
        ['jobs-front-end'],
        async () => {},
      );

      await expect(semBloco.fetchDescriptionFor(VAGA)).resolves.toBe('');
    });

    it('devolve vazio sem lancar quando a fonte falha', async () => {
      const quebrado = new ProgramathorScraperProvider(
        failingHttpClient('503 Service Unavailable'),
        ['jobs-front-end'],
        async () => {},
      );

      await expect(quebrado.fetchDescriptionFor(VAGA)).resolves.toBe('');
    });
  });
});

interface CardOptions {
  readonly title?: string;
  readonly company?: string;
  readonly location?: string;
  readonly href?: string;
}

function card(options: CardOptions = {}): string {
  const {
    title = 'Dev Frontend',
    company = 'Acme Corp',
    location = 'Salvador (Presencial)',
    href = '/jobs/1-dev-frontend',
  } = options;

  return (
    '<div class="cell-list">' +
    `<a href="${href}">` +
    `<h3>${title}</h3>` +
    '<div class="cell-list-content-icon">' +
    `<span>${company}</span><span>${location}</span>` +
    '</div>' +
    "<div><span class='tag-list'>React</span></div>" +
    '</a></div>'
  );
}