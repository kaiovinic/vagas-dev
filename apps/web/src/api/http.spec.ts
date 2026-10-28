import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiContractError, ApiError, buildPath, fetchJson } from '@/api/http';
import { createQueryClient } from '@/lib/query-client';
import { jsonResponse } from '../../test/render';

const schema = z.object({ total: z.number() });

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const spy =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);

  vi.stubGlobal('fetch', spy);

  return spy;
}

describe('buildPath', () => {
  it('monta a query string com os parametros informados', () => {
    expect(buildPath('/api/jobs', { page: 2, search: 'react' })).toBe(
      '/api/jobs?page=2&search=react',
    );
  });

  it('codifica valores com espaco e acento', () => {
    expect(buildPath('/api/jobs', { company: 'Acme Corp' })).toBe(
      '/api/jobs?company=Acme+Corp',
    );
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['texto vazio', ''],
  ])('ignora parametro %s', (_label, value) => {
    expect(buildPath('/api/jobs', { search: value })).toBe('/api/jobs');
  });

  it('mantem o caminho limpo quando nao ha parametros', () => {
    expect(buildPath('/api/jobs')).toBe('/api/jobs');
  });

  it('serializa booleanos como texto', () => {
    expect(buildPath('/api/jobs', { isRemote: true })).toBe('/api/jobs?isRemote=true');
  });
});

describe('fetchJson', () => {
  it('devolve o corpo validado pelo schema', async () => {
    stubFetch(jsonResponse({ total: 7 }));

    await expect(fetchJson('/api/x', schema)).resolves.toEqual({ total: 7 });
  });

  it('pede json e repassa o AbortSignal', async () => {
    const spy = stubFetch(jsonResponse({ total: 1 }));
    const controller = new AbortController();

    await fetchJson('/api/x', schema, controller.signal);

    expect(spy).toHaveBeenCalledWith('/api/x', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  });

  it('omite o signal quando nao informado', async () => {
    const spy = stubFetch(jsonResponse({ total: 1 }));

    await fetchJson('/api/x', schema);

    expect(spy).toHaveBeenCalledWith('/api/x', {
      headers: { Accept: 'application/json' },
    });
  });

  it('usa a mensagem de erro da API', async () => {
    stubFetch(jsonResponse({ message: 'Parametros invalidos' }, 400));

    await expect(fetchJson('/api/x', schema)).rejects.toThrow('Parametros invalidos');
  });

  it('expoe o status no ApiError', async () => {
    stubFetch(jsonResponse({ message: 'quebrou' }, 503));

    await expect(fetchJson('/api/x', schema)).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
    });
  });

  it.each([
    ['corpo sem message', { erro: 'x' }],
    ['message que nao e texto', { message: 42 }],
  ])('cai na mensagem padrao com %s', async (_label, body) => {
    stubFetch(jsonResponse(body, 500));

    await expect(fetchJson('/api/x', schema)).rejects.toThrow('Falha na requisicao (500)');
  });

  it('cai na mensagem padrao quando o corpo do erro nao e json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('nao e json');
        },
      } as unknown as Response),
    );

    await expect(fetchJson('/api/x', schema)).rejects.toThrow('Falha na requisicao (502)');
  });

  it('acusa contrato quebrado quando a resposta nao casa com o schema', async () => {
    stubFetch(jsonResponse({ total: 'muitas' }));

    await expect(fetchJson('/api/dashboard/summary', schema)).rejects.toBeInstanceOf(
      ApiContractError,
    );
  });

  it('descreve o campo e o caminho do contrato quebrado', async () => {
    stubFetch(jsonResponse({ total: 'muitas' }));

    await expect(fetchJson('/api/x', schema)).rejects.toThrow(/total/);
  });

  it('propaga falha de rede', async () => {
    stubFetch(new Error('Failed to fetch'));

    await expect(fetchJson('/api/x', schema)).rejects.toThrow('Failed to fetch');
  });
});

describe('createQueryClient', () => {
  function retryOf(client: ReturnType<typeof createQueryClient>): (
    failureCount: number,
    error: Error,
  ) => boolean {
    const { retry } = client.getDefaultOptions().queries ?? {};

    if (typeof retry !== 'function') {
      throw new Error('retry deveria ser uma funcao');
    }

    return retry as (failureCount: number, error: Error) => boolean;
  }

  it('nao repete erro de contrato', () => {
    const retry = retryOf(createQueryClient());

    expect(retry(0, new ApiContractError('/api/x', ['total: esperado numero']))).toBe(false);
  });

  it('nao repete erro 4xx', () => {
    const retry = retryOf(createQueryClient());

    expect(retry(0, new ApiError('invalido', 400))).toBe(false);
  });

  it('repete erro 5xx e falha de rede', () => {
    const retry = retryOf(createQueryClient());

    expect(retry(0, new ApiError('indisponivel', 503))).toBe(true);
    expect(retry(0, new Error('Failed to fetch'))).toBe(true);
  });

  it('para depois do limite de tentativas', () => {
    const retry = retryOf(createQueryClient());

    expect(retry(2, new Error('Failed to fetch'))).toBe(false);
  });
});
