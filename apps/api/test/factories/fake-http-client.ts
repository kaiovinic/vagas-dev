import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  HttpRequestOptions,
  HttpResponse,
  IHttpClient,
} from '@/domain/providers/http-client';

const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures');

export function readFixture(fileName: string): string {
  return readFileSync(resolve(FIXTURES_DIR, fileName), 'utf8');
}

export function readJsonFixture<TBody>(fileName: string): TBody {
  return JSON.parse(readFixture(fileName)) as TBody;
}

export interface RecordedRequest {
  readonly url: string;
  readonly options: HttpRequestOptions | undefined;
}

/**
 * Duplo de teste da porta `IHttpClient`: devolve a fixture correspondente a url
 * e registra as chamadas, sem nenhum acesso a rede.
 */
export class FakeHttpClient implements IHttpClient {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly respond: (url: string) => unknown) {}

  get requestedUrls(): string[] {
    return this.requests.map((request) => request.url);
  }

  async get<TBody>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<TBody>> {
    this.requests.push({ url, options });

    const body = this.respond(url);

    if (body instanceof Error) {
      throw body;
    }

    return { status: 200, body: body as TBody };
  }
}

/** Cliente que sempre falha, para exercitar o contrato de nao propagar excecao. */
export function failingHttpClient(message = 'fonte fora do ar'): FakeHttpClient {
  return new FakeHttpClient(() => new Error(message));
}
