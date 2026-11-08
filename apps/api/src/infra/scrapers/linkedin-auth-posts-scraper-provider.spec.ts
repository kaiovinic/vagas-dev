import { beforeEach, describe, expect, it } from 'vitest';

import {
  LINKEDIN_AUTH_POSTS_SOURCE,
  LinkedinAuthPostsScraperProvider,
} from '@/infra/scrapers/linkedin-auth-posts-scraper-provider';
import { FakeHttpClient, readJsonFixture } from '../../../test/factories/fake-http-client';
import { FakeOperationalAlerter, StubSourceLastRunReader } from '../../../test/factories/doubles';

const WORKER_URL = 'http://posts-worker:4000';

const OK = readJsonFixture<unknown>('harvest-ok.json');
const SESSION_LOST = readJsonFixture<unknown>('harvest-session-lost.json');
const NEVER_RAN = readJsonFixture<unknown>('harvest-never-ran.json');
const EMPTY = readJsonFixture<unknown>('harvest-empty.json');

/**
 * As datas das fixtures saem do snowflake, e por isso sao fixas: o teste nao
 * precisa de data recente porque o provider NAO aplica a janela de 72h — quem
 * aplica e o `JobRuleEngine`, que ja conta essa rejeicao na aba `Regras`.
 */
const PRIMEIRO_POST_EM = '2026-10-28T17:30:05.032Z';
const SEGUNDO_POST_EM = '2026-10-28T16:41:38.764Z';

/** A colheita de `harvest-ok.json`. */
const COLHIDO_EM = new Date('2026-11-05T09:12:44.000Z');

describe('LinkedinAuthPostsScraperProvider', () => {
  let http: FakeHttpClient;
  let lastRun: StubSourceLastRunReader;
  let alerter: FakeOperationalAlerter;

  function build(payload: unknown): LinkedinAuthPostsScraperProvider {
    http = new FakeHttpClient(() => payload);

    return new LinkedinAuthPostsScraperProvider(http, lastRun, alerter, WORKER_URL);
  }

  beforeEach(() => {
    lastRun = new StubSourceLastRunReader();
    alerter = new FakeOperationalAlerter();
  });

  it('identifica a fonte', () => {
    const provider = build(OK);

    expect(provider.source).toBe(LINKEDIN_AUTH_POSTS_SOURCE);
    expect(provider.label).toBe('Publicacoes do LinkedIn (sessao)');
  });

  it('le a colheita do worker, e nada mais', async () => {
    await build(OK).scrape();

    expect(http.requestedUrls).toEqual(['http://posts-worker:4000/posts']);
  });

  describe('colheita com publicacoes', () => {
    it('converte a publicacao em vaga bruta de post social', async () => {
      const [vaga] = await build(OK).scrape();

      expect(vaga).toMatchObject({
        company: 'Maria Silva',
        recruiterName: 'Maria Silva',
        source: LINKEDIN_AUTH_POSTS_SOURCE,
        url: 'https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416/',
        origin: 'SOCIAL_POST',
        publishedAtSource: 'SOURCE',
        workModel: 'UNKNOWN',
        location: '',
      });
    });

    /** O ponto central do contrato: a data sai do snowflake, nao do relogio. */
    it('tira a data exata do snowflake da URL', async () => {
      const vagas = await build(OK).scrape();

      expect(vagas[0]?.publishedAt?.toISOString()).toBe(PRIMEIRO_POST_EM);
      expect(vagas[1]?.publishedAt?.toISOString()).toBe(SEGUNDO_POST_EM);
    });

    it('le a data tambem da URL de compartilhamento, que traz o autor', async () => {
      const vagas = await build(OK).scrape();

      expect(vagas[1]?.company).toBe('Joao Pereira');
      expect(vagas[1]?.publishedAt?.toISOString()).toBe(SEGUNDO_POST_EM);
    });

    it('usa o texto da publicacao como titulo', async () => {
      const [vaga] = await build(OK).scrape();

      expect(vaga?.title).toContain('Estamos contratando pessoa desenvolvedora React em Salvador');
    });

    it('guarda os links do anuncio na descricao, onde o motor de regras os ve', async () => {
      const [vaga] = await build(OK).scrape();

      expect(vaga?.description).toContain('https://portal.gupy.io/job/1234');
      expect(vaga?.description).toContain('https://lnkd.in/dAbCdEf');
    });

    it('publicacao sem link nenhum nao ganha linha de link vazia', async () => {
      const vagas = await build(OK).scrape();

      expect(vagas[1]?.description).toBe(
        'Vaga de pessoa desenvolvedora .NET, 100% remoto. Comentem aqui que eu chamo no privado.',
      );
    });

    /**
     * Sem id na URL nao ha snowflake, e sem snowflake nao ha data. Carimbar o
     * instante da captura seria errar por horas dentro de uma janela de 72h.
     */
    it('descarta publicacao cuja URL nao carrega o id', async () => {
      const vagas = await build(OK).scrape();

      expect(vagas.map((vaga) => vaga.company)).not.toContain('Sem Identificacao');
    });

    it('descarta publicacao sem texto', async () => {
      const vagas = await build(OK).scrape();

      expect(vagas.map((vaga) => vaga.company)).not.toContain('Autor Sem Texto');
    });

    it('devolve so o que aproveitou', async () => {
      const vagas = await build(OK).scrape();

      expect(vagas).toHaveLength(2);
    });
  });

  describe('colheita vazia', () => {
    it('devolve lista vazia sem reclamar', async () => {
      expect(await build(EMPTY).scrape()).toEqual([]);
    });

    it('nao alerta: colheita sem resultado nao e falha', async () => {
      await build(EMPTY).scrape();

      expect(alerter.alerts).toEqual([]);
    });
  });

  describe('worker que ainda nao colheu', () => {
    it('devolve lista vazia', async () => {
      expect(await build(NEVER_RAN).scrape()).toEqual([]);
    });

    it('nao fica devendo captura: nao se declara pronto', async () => {
      expect(await build(NEVER_RAN).isDue(COLHIDO_EM)).toBe(false);
    });
  });

  describe('sessao caida', () => {
    it('ainda entrega a colheita preservada, que seca sozinha na janela de 72h', async () => {
      const vagas = await build(SESSION_LOST).scrape();

      expect(vagas).toHaveLength(1);
      expect(vagas[0]?.publishedAt?.toISOString()).toBe(PRIMEIRO_POST_EM);
    });

    it('alerta uma pessoa, dizendo o que fazer', async () => {
      await build(SESSION_LOST).scrape();

      expect(alerter.alerts).toHaveLength(1);
      expect(alerter.alerts[0]?.source).toBe(LINKEDIN_AUTH_POSTS_SOURCE);
      expect(alerter.alerts[0]?.action).toContain('session:login');
    });

    /** Alerta a cada 2h vira alerta que se aprende a ignorar. */
    it('nao repete o alerta enquanto a sessao segue caida', async () => {
      const provider = build(SESSION_LOST);

      await provider.scrape();
      await provider.scrape();

      expect(alerter.alerts).toHaveLength(1);
    });

    it('volta a alertar depois de a sessao ser renovada', async () => {
      let payload: unknown = SESSION_LOST;
      http = new FakeHttpClient(() => payload);
      const provider = new LinkedinAuthPostsScraperProvider(http, lastRun, alerter, WORKER_URL);

      await provider.scrape();
      payload = OK;
      await provider.scrape();
      payload = SESSION_LOST;
      await provider.scrape();

      expect(alerter.alerts).toHaveLength(2);
    });

    /** Perder um aviso nao pode derrubar a captura das outras sete fontes. */
    it('segue entregando vagas quando o alerta nao sai', async () => {
      alerter.shouldFail = true;

      expect(await build(SESSION_LOST).scrape()).toHaveLength(1);
    });
  });

  describe('cadencia: a tabela de saude precisa dizer a idade da colheita', () => {
    it('esta pronto quando a fonte nunca rodou', async () => {
      lastRun.lastRunAt = null;

      expect(await build(OK).isDue(COLHIDO_EM)).toBe(true);
    });

    it('esta pronto quando a colheita e mais nova que a ultima execucao', async () => {
      lastRun.lastRunAt = new Date(COLHIDO_EM.getTime() - 60_000);

      expect(await build(OK).isDue(COLHIDO_EM)).toBe(true);
    });

    /**
     * O que isto evita: sem a comparacao, a leitura gratuita do cache seria
     * registrada como execucao a cada 2h, e o painel diria "agora" para uma
     * colheita de sete horas atras.
     */
    it('nao se declara pronto para reler a mesma colheita', async () => {
      lastRun.lastRunAt = new Date(COLHIDO_EM.getTime() + 60_000);

      expect(await build(OK).isDue(COLHIDO_EM)).toBe(false);
    });

    it('pergunta pela propria fonte', async () => {
      await build(OK).isDue(COLHIDO_EM);

      expect(lastRun.asked).toEqual([LINKEDIN_AUTH_POSTS_SOURCE]);
    });

    it('esta pronto com a sessao caida, para o alerta poder sair', async () => {
      expect(await build(SESSION_LOST).isDue(COLHIDO_EM)).toBe(true);
    });

    it('para de insistir depois de alertar a sessao caida', async () => {
      const provider = build(SESSION_LOST);

      await provider.scrape();

      expect(await provider.isDue(COLHIDO_EM)).toBe(false);
    });
  });

  describe('contrato de nao propagar excecao (LSP)', () => {
    it('worker fora do ar devolve lista vazia', async () => {
      const falhando = new FakeHttpClient(() => new Error('conexao recusada'));
      const provider = new LinkedinAuthPostsScraperProvider(
        falhando,
        lastRun,
        alerter,
        WORKER_URL,
      );

      expect(await provider.scrape()).toEqual([]);
    });

    it('worker fora do ar nao se declara pronto, e nao explode', async () => {
      const falhando = new FakeHttpClient(() => new Error('conexao recusada'));
      const provider = new LinkedinAuthPostsScraperProvider(
        falhando,
        lastRun,
        alerter,
        WORKER_URL,
      );

      expect(await provider.isDue(COLHIDO_EM)).toBe(false);
    });

    it('corpo em formato inesperado devolve lista vazia', async () => {
      expect(await build({ qualquer: 'coisa' }).scrape()).toEqual([]);
    });

    it('corpo nulo devolve lista vazia', async () => {
      expect(await build(null).scrape()).toEqual([]);
    });

    it('publicacao com campos de tipo errado e ignorada', async () => {
      const torto = {
        harvestedAt: '2026-11-05T09:12:44.000Z',
        status: 'ok',
        searches: [],
        posts: [{ url: 42, author: null, text: ['nao', 'e', 'string'] }],
      };

      expect(await build(torto).scrape()).toEqual([]);
    });
  });

  describe('sem worker configurado', () => {
    it('vira no-op silencioso, como a fonte do Serper sem chave', async () => {
      const provider = new LinkedinAuthPostsScraperProvider(
        new FakeHttpClient(() => OK),
        lastRun,
        alerter,
        '',
      );

      expect(await provider.scrape()).toEqual([]);
      expect(await provider.isDue(COLHIDO_EM)).toBe(false);
    });
  });
});
