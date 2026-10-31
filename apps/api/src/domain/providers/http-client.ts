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
  /**
   * Existe por causa de uma unica fonte: a API do Serper so aceita POST, com a
   * consulta no corpo. Nenhum portal de vagas precisa disso — todos servem
   * HTML ou JSON por GET.
   */
  post<TBody>(
    url: string,
    body: unknown,
    options?: HttpRequestOptions,
  ): Promise<HttpResponse<TBody>>;
}
