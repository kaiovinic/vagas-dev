import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';

import { AxiosHttpClient } from '@/infra/http/axios-http-client';

function axiosStub(response: unknown = { status: 200, data: { ok: true } }): AxiosInstance {
  return { get: vi.fn().mockResolvedValue(response) } as unknown as AxiosInstance;
}

describe('AxiosHttpClient', () => {
  it('devolve status e corpo da resposta', async () => {
    const client = new AxiosHttpClient(axiosStub({ status: 201, data: { ok: true } }));

    await expect(client.get('https://acme.com')).resolves.toEqual({
      status: 201,
      body: { ok: true },
    });
  });

  it('aplica user-agent e timeout padrao', async () => {
    const axios = axiosStub();
    const client = new AxiosHttpClient(axios);

    await client.get('https://acme.com');

    expect(axios.get).toHaveBeenCalledWith('https://acme.com', {
      timeout: 15_000,
      headers: { 'User-Agent': expect.stringContaining('Mozilla/5.0') },
    });
  });

  it('mescla headers e timeout informados pelo coletor', async () => {
    const axios = axiosStub();
    const client = new AxiosHttpClient(axios);

    await client.get('https://acme.com', {
      headers: { Accept: 'application/json' },
      timeoutInMs: 1_000,
    });

    expect(axios.get).toHaveBeenCalledWith('https://acme.com', {
      timeout: 1_000,
      headers: {
        'User-Agent': expect.stringContaining('Mozilla/5.0'),
        Accept: 'application/json',
      },
    });
  });

  it('propaga a falha de rede para a base do coletor tratar', async () => {
    const axios = {
      get: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
    } as unknown as AxiosInstance;

    await expect(new AxiosHttpClient(axios).get('https://acme.com')).rejects.toThrow('ECONNRESET');
  });
});
