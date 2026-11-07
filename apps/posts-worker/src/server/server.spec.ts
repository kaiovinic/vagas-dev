import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { EMPTY_HARVEST, type HarvestFile } from '@/contract';
import type { HarvestRead } from '@/server/harvest-store';
import { buildServer } from '@/server/server';

const HARVEST: HarvestFile = {
  harvestedAt: '2026-11-05T09:12:44.000Z',
  status: 'ok',
  searches: [],
  posts: [
    {
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7521262024920764416/',
      author: 'Maria Silva',
      text: 'Estamos contratando pessoa desenvolvedora React em Salvador.',
      links: ['https://portal.gupy.io/job/1234'],
      hasJobAction: true,
    },
  ],
};

let app: FastifyInstance | undefined;

/** `inject()` nao abre porta: o teste exercita as rotas sem subir rede. */
function serve(read: HarvestRead, sessionPresent = true): FastifyInstance {
  app = buildServer({
    readHarvest: () => Promise.resolve(read),
    isSessionPresent: () => Promise.resolve(sessionPresent),
  });

  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /posts', () => {
  it('devolve a colheita do disco, sem transformar nada', async () => {
    const response = await serve({ outcome: 'read', harvest: HARVEST }).inject('/posts');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(HARVEST);
  });

  it('responde json', async () => {
    const response = await serve({ outcome: 'read', harvest: HARVEST }).inject('/posts');

    expect(response.headers['content-type']).toContain('application/json');
  });

  /**
   * Nunca 404: a API precisa de um documento valido dizendo "ainda nao ha
   * nada", para tratar como fonte sem vagas em vez de falha.
   */
  it('devolve a colheita vazia quando o arquivo nao existe', async () => {
    const response = await serve({ outcome: 'missing' }).inject('/posts');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(EMPTY_HARVEST);
  });

  it('devolve a colheita vazia quando o arquivo esta ilegivel', async () => {
    const response = await serve({ outcome: 'unreadable', reason: 'json truncado' }).inject(
      '/posts',
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(EMPTY_HARVEST);
  });

  describe('colheita em gravacao', () => {
    /**
     * 503, e nao a colheita vazia: `never-ran` e uma afirmacao forte, e a API a
     * registra na tabela de saude. Dizer isso porque o arquivo estava sendo
     * gravado por 200ms seria mentir sobre um worker que acabou de colher.
     */
    it('responde 503 em vez de fingir que nunca colheu', async () => {
      const response = await serve({ outcome: 'busy' }).inject('/posts');

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ status: 'busy' });
    });

    it('diz em quanto tempo vale perguntar de novo', async () => {
      const response = await serve({ outcome: 'busy' }).inject('/posts');

      expect(response.headers['retry-after']).toBe('5');
    });
  });
});

describe('GET /health', () => {
  it('responde 200 com o worker de pe', async () => {
    const response = await serve({ outcome: 'read', harvest: HARVEST }).inject('/health');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('conta a idade da colheita, que e o que o painel mostra', async () => {
    const response = await serve({ outcome: 'read', harvest: HARVEST }).inject('/health');

    expect(response.json()).toMatchObject({
      harvest: { state: 'read', harvestedAt: HARVEST.harvestedAt, status: 'ok', posts: 1 },
    });
  });

  it('informa o tempo de pe, para distinguir worker reiniciado de worker parado', async () => {
    const response = await serve({ outcome: 'read', harvest: HARVEST }).inject('/health');

    expect(response.json().uptimeInSeconds).toBeGreaterThanOrEqual(0);
  });

  /** Nunca o conteudo: o `state.json` E a credencial da conta. */
  it('diz se ha sessao salva, e so isso', async () => {
    const response = await serve({ outcome: 'read', harvest: HARVEST }).inject('/health');

    expect(response.json().session).toEqual({ present: true });
  });

  it('fica degradado sem sessao salva: o worker nao tem como colher', async () => {
    const response = await serve({ outcome: 'read', harvest: HARVEST }, false).inject('/health');

    expect(response.json()).toMatchObject({ status: 'degraded', session: { present: false } });
  });

  it('fica degradado com a colheita ilegivel', async () => {
    const response = await serve({ outcome: 'unreadable', reason: 'json truncado' }).inject(
      '/health',
    );

    expect(response.json()).toMatchObject({
      status: 'degraded',
      harvest: { state: 'unreadable', reason: 'json truncado' },
    });
  });

  /** Nao e falha: e um worker novo que ainda nao rodou o cron. */
  it('segue ok antes da primeira colheita', async () => {
    const response = await serve({ outcome: 'missing' }).inject('/health');

    expect(response.json()).toMatchObject({
      status: 'ok',
      harvest: { state: 'missing', harvestedAt: null, posts: 0 },
    });
  });

  it('segue ok com a colheita em gravacao', async () => {
    const response = await serve({ outcome: 'busy' }).inject('/health');

    expect(response.json()).toMatchObject({ status: 'ok', harvest: { state: 'busy' } });
  });

  /**
   * Por que 200 mesmo degradado: o healthcheck do Docker reinicia o container
   * quando isto falha, e nenhum restart traz a sessao de volta. Um loop de
   * restart trocaria um problema visivel por um invisivel.
   */
  it('nao reprova o healthcheck por problema que restart nao resolve', async () => {
    const response = await serve({ outcome: 'unreadable', reason: 'x' }, false).inject('/health');

    expect(response.statusCode).toBe(200);
  });
});

describe('servidor montado sem injecao', () => {
  /**
   * O que a producao usa: sem argumento, o servidor le o volume de verdade.
   * O teste nao sabe o que ha lá e nao devia saber — cobra que a rota responda.
   */
  it('le o volume configurado e responde', async () => {
    app = buildServer();

    expect((await app.inject('/health')).statusCode).toBe(200);
  });
});

describe('rota desconhecida', () => {
  it('responde 404, sem expor nada do worker', async () => {
    const response = await serve({ outcome: 'missing' }).inject('/qualquer-outra');

    expect(response.statusCode).toBe(404);
  });
});
