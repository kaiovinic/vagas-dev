import { beforeEach, describe, expect, it } from 'vitest';

import type {
  HttpRequestOptions,
  HttpResponse,
  IHttpClient,
} from '@/domain/providers/http-client';
import {
  HTTP_RETRY_BASE_DELAY_IN_MS,
  HTTP_RETRY_MAX_DELAY_IN_MS,
  RETRYABLE_STATUSES,
  RetryingHttpClient,
} from '@/infra/http/retrying-http-client';

/** Erro no formato que o axios produz: status e cabecalhos dentro de `response`. */
function httpError(status: number, headers: Record<string, string> = {}): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, headers },
  });
}

/** Falha de rede: nao ha resposta, so o codigo do socket. */
function networkError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * Cliente interno que devolve cada item da fila na ordem: `Error` e lancado,
 * qualquer outro valor volta como corpo da resposta.
 */
class QueuedHttpClient implements IHttpClient {
  readonly calls: { readonly url: string; readonly body?: unknown }[] = [];

  constructor(private readonly queue: unknown[]) {}

  async get<TBody>(url: string, _options?: HttpRequestOptions): Promise<HttpResponse<TBody>> {
    this.calls.push({ url });

    return this.next<TBody>();
  }

  async post<TBody>(
    url: string,
    body: unknown,
    _options?: HttpRequestOptions,
  ): Promise<HttpResponse<TBody>> {
    this.calls.push({ url, body });

    return this.next<TBody>();
  }

  private async next<TBody>(): Promise<HttpResponse<TBody>> {
    const value = this.queue.shift();

    if (value instanceof Error) {
      throw value;
    }

    return { status: 200, body: value as TBody };
  }
}

const URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

describe('RetryingHttpClient', () => {
  let waited: number[];

  function makeClient(queue: unknown[], attempts = 3): [RetryingHttpClient, QueuedHttpClient] {
    const inner = new QueuedHttpClient(queue);
    const client = new RetryingHttpClient(
      inner,
      async (ms) => {
        waited.push(ms);
      },
      attempts,
    );

    return [client, inner];
  }

  beforeEach(() => {
    waited = [];
  });

  it('nao espera nada quando a primeira chamada funciona', async () => {
    const [client, inner] = makeClient(['<html>ok</html>']);

    const response = await client.get<string>(URL);

    expect(response.body).toBe('<html>ok</html>');
    expect(inner.calls).toHaveLength(1);
    expect(waited).toEqual([]);
  });

  it('repete depois de um 429 e devolve a resposta boa', async () => {
    const [client, inner] = makeClient([httpError(429), 'cards']);

    const response = await client.get<string>(URL);

    expect(response.body).toBe('cards');
    expect(inner.calls).toHaveLength(2);
  });

  it('dobra a espera a cada tentativa', async () => {
    const [client] = makeClient([httpError(503), httpError(503), 'cards']);

    await client.get<string>(URL);

    expect(waited).toEqual([HTTP_RETRY_BASE_DELAY_IN_MS, HTTP_RETRY_BASE_DELAY_IN_MS * 2]);
  });

  it('desiste depois do teto de tentativas e propaga o erro', async () => {
    const [client, inner] = makeClient([httpError(429), httpError(429), httpError(429)]);

    await expect(client.get(URL)).rejects.toThrow('status code 429');
    expect(inner.calls).toHaveLength(3);
    // Duas esperas, e nao tres: nao se espera depois da ultima tentativa.
    expect(waited).toHaveLength(2);
  });

  it.each(RETRYABLE_STATUSES)('repete em HTTP %i', async (status) => {
    const [client, inner] = makeClient([httpError(status), 'cards']);

    await client.get(URL);

    expect(inner.calls).toHaveLength(2);
  });

  it.each([403, 404, 410, 422])('nao repete em HTTP %i', async (status) => {
    const [client, inner] = makeClient([httpError(status), 'cards']);

    await expect(client.get(URL)).rejects.toThrow(`status code ${status}`);
    expect(inner.calls).toHaveLength(1);
    expect(waited).toEqual([]);
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'])(
    'repete na falha de rede %s',
    async (code) => {
      const [client, inner] = makeClient([networkError(code), 'cards']);

      await client.get(URL);

      expect(inner.calls).toHaveLength(2);
    },
  );

  it('nao repete erro que nao e de rede nem de status', async () => {
    const [client, inner] = makeClient([new Error('html inesperado'), 'cards']);

    await expect(client.get(URL)).rejects.toThrow('html inesperado');
    expect(inner.calls).toHaveLength(1);
  });

  it('obedece ao Retry-After da fonte em vez do backoff', async () => {
    const [client] = makeClient([httpError(429, { 'retry-after': '5' }), 'cards']);

    await client.get(URL);

    expect(waited).toEqual([5_000]);
  });

  it('limita o Retry-After exagerado ao teto', async () => {
    const [client] = makeClient([httpError(429, { 'retry-after': '600' }), 'cards']);

    await client.get(URL);

    expect(waited).toEqual([HTTP_RETRY_MAX_DELAY_IN_MS]);
  });

  it.each([['data HTTP', 'Wed, 21 Oct 2026 07:28:00 GMT'], ['valor vazio', ''], ['zero', '0']])(
    'cai no backoff quando o Retry-After vem como %s',
    async (_caso, header) => {
      const [client] = makeClient([httpError(503, { 'retry-after': header }), 'cards']);

      await client.get(URL);

      expect(waited).toEqual([HTTP_RETRY_BASE_DELAY_IN_MS]);
    },
  );

  it('repete tambem o post, preservando o corpo enviado', async () => {
    const [client, inner] = makeClient([httpError(502), { organic: [] }]);

    await client.post(URL, { q: 'vaga react' });

    expect(inner.calls).toHaveLength(2);
    expect(inner.calls.map((call) => call.body)).toEqual([{ q: 'vaga react' }, { q: 'vaga react' }]);
  });

  it('nao repete quando configurado com uma tentativa so', async () => {
    const [client, inner] = makeClient([httpError(429), 'cards'], 1);

    await expect(client.get(URL)).rejects.toThrow('status code 429');
    expect(inner.calls).toHaveLength(1);
  });
});
