export const HTTP_CLIENT = Symbol.for('HTTP_CLIENT');

export interface HttpRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutInMs?: number;
}

export interface HttpResponse<TBody> {
  readonly status: number;
  readonly body: TBody;
}

/**
 * Porta de saida HTTP. Os coletores dependem desta abstracao e nunca do axios,
 * o que permite testa-los com fixtures reais sem rede (DIP).
 */
export interface IHttpClient {
  get<TBody>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<TBody>>;
}
