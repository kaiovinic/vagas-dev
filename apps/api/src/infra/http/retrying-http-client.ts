import { Logger } from '@nestjs/common';

import type {
  HttpRequestOptions,
  HttpResponse,
  IHttpClient,
} from '@/domain/providers/http-client';

/**
 * Status que valem nova tentativa.
 *
 * Todos dizem "tente de novo mais tarde": fila cheia (429), servidor
 * momentaneamente indisponivel (500, 502, 503, 504) ou tempo esgotado antes de
 * a resposta chegar (408, 425). Qualquer outro 4xx e resposta definitiva — 404
 * de vaga retirada do ar, 403 de bloqueio por impressao digital de TLS — e
 * repetir so gastaria requisicao e tempo.
 */
export const RETRYABLE_STATUSES: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

/**
 * Falhas de rede, em que nem houve resposta. `ECONNABORTED` e o que o axios
 * devolve quando o `timeout` estoura.
 */
const RETRYABLE_CODES: readonly string[] = [
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
  'ERR_NETWORK',
];

/** Tentativas no total, nao tentativas extras: 3 significa 1 chamada + 2 repeticoes. */
export const HTTP_RETRY_ATTEMPTS = 3;

/** Primeira espera. Dobra a cada tentativa: 1s, 2s, 4s. */
export const HTTP_RETRY_BASE_DELAY_IN_MS = 1_000;

/**
 * Teto da espera.
 *
 * Vale sobretudo para o `Retry-After`: uma fonte irritada pode pedir 300
 * segundos, e a captura inteira roda a cada 2 horas — esperar isso dentro do
 * ciclo atrasaria as outras fontes para nada, ja que o proximo ciclo tentaria
 * de novo de qualquer forma.
 */
export const HTTP_RETRY_MAX_DELAY_IN_MS = 30_000;

/**
 * Decorator de `IHttpClient` que repete a chamada com espera exponencial.
 *
 * E decorator, e nao codigo dentro do `AxiosHttpClient`, por dois motivos: o
 * adaptador segue com uma responsabilidade so (traduzir axios para a porta), e
 * a politica de repeticao fica testavel sem rede e sem axios. Para quem chama,
 * nada muda — a porta e a mesma (LSP).
 *
 * Nenhum coletor precisa saber que isto existe: a fiacao do modulo entrega o
 * cliente ja embrulhado no token `HTTP_CLIENT`.
 */
export class RetryingHttpClient implements IHttpClient {
  private readonly logger = new Logger(RetryingHttpClient.name);

  constructor(
    private readonly inner: IHttpClient,
    private readonly wait: (ms: number) => Promise<void> = sleep,
    private readonly attempts: number = HTTP_RETRY_ATTEMPTS,
    private readonly baseDelayInMs: number = HTTP_RETRY_BASE_DELAY_IN_MS,
    private readonly maxDelayInMs: number = HTTP_RETRY_MAX_DELAY_IN_MS,
  ) {}

  async get<TBody>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<TBody>> {
    return this.withRetry(url, () => this.inner.get<TBody>(url, options));
  }

  async post<TBody>(
    url: string,
    body: unknown,
    options?: HttpRequestOptions,
  ): Promise<HttpResponse<TBody>> {
    return this.withRetry(url, () => this.inner.post<TBody>(url, body, options));
  }

  private async withRetry<TBody>(
    url: string,
    send: () => Promise<HttpResponse<TBody>>,
  ): Promise<HttpResponse<TBody>> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await send();
      } catch (error: unknown) {
        if (attempt >= this.attempts || !isRetryable(error)) {
          throw error;
        }

        const delay = this.delayFor(attempt, error);

        this.logger.warn(`${describeFailure(error)} em ${url}: nova tentativa em ${delay}ms`);

        await this.wait(delay);
      }
    }
  }

  /** A fonte manda quanto esperar quando sabe; senao, a espera dobra sozinha. */
  private delayFor(attempt: number, error: unknown): number {
    const requested = retryAfterInMs(error);
    const backoff = this.baseDelayInMs * 2 ** (attempt - 1);

    return Math.min(requested ?? backoff, this.maxDelayInMs);
  }
}

function isRetryable(error: unknown): boolean {
  const status = statusOf(error);

  if (status !== undefined) {
    return RETRYABLE_STATUSES.includes(status);
  }

  return RETRYABLE_CODES.includes(codeOf(error) ?? '');
}

/**
 * `Retry-After` em segundos, o formato que o LinkedIn e as APIs de vagas usam.
 *
 * A especificacao tambem admite data HTTP; ali o backoff resolve igual, e
 * interpretar data sem relogio injetado seria o tipo de detalhe que quebra em
 * teste por fuso.
 */
function retryAfterInMs(error: unknown): number | undefined {
  const header = headerOf(error, 'retry-after');
  const seconds = Number(header);

  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

function statusOf(error: unknown): number | undefined {
  const status = responseOf(error)?.status;

  return typeof status === 'number' ? status : undefined;
}

function headerOf(error: unknown, name: string): string | undefined {
  const headers = responseOf(error)?.headers;

  if (headers === null || typeof headers !== 'object') {
    return undefined;
  }

  const value = (headers as Record<string, unknown>)[name];

  return typeof value === 'string' ? value : undefined;
}

interface ErrorResponse {
  readonly status?: unknown;
  readonly headers?: unknown;
}

function responseOf(error: unknown): ErrorResponse | undefined {
  if (error === null || typeof error !== 'object') {
    return undefined;
  }

  const { response } = error as { response?: unknown };

  return response !== null && typeof response === 'object' ? (response as ErrorResponse) : undefined;
}

function codeOf(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') {
    return undefined;
  }

  const { code } = error as { code?: unknown };

  return typeof code === 'string' ? code : undefined;
}

function describeFailure(error: unknown): string {
  const status = statusOf(error);

  return status !== undefined ? `HTTP ${status}` : (codeOf(error) ?? 'falha de rede');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
