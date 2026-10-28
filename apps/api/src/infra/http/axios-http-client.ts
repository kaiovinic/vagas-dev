import { Injectable, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

import type {
  HttpRequestOptions,
  HttpResponse,
  IHttpClient,
} from '@/domain/providers/http-client';

const DEFAULT_TIMEOUT_IN_MS = 15_000;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Adaptador do axios para a porta `IHttpClient`.
 *
 * Mantem o `transformResponse` padrao do axios de proposito: ele tenta `JSON.parse`
 * e devolve a string crua quando falha, o que entrega objeto para as fontes JSON
 * (Remotar, GitHub) e HTML em texto para as que vao ao cheerio.
 */
@Injectable()
export class AxiosHttpClient implements IHttpClient {
  constructor(@Optional() private readonly client: AxiosInstance = axios.create()) {}

  async get<TBody>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<TBody>> {
    const response = await this.client.get<TBody>(url, {
      timeout: options?.timeoutInMs ?? DEFAULT_TIMEOUT_IN_MS,
      headers: { 'User-Agent': DEFAULT_USER_AGENT, ...options?.headers },
    });

    return { status: response.status, body: response.data };
  }
}
