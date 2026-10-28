import type { ZodTypeAny, z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiContractError extends Error {
  constructor(
    readonly path: string,
    readonly issues: readonly string[],
  ) {
    super(`Resposta inesperada de ${path}: ${issues.join('; ')}`);
    this.name = 'ApiContractError';
  }
}

export type QueryParams = Readonly<
  Record<string, string | number | boolean | undefined | null>
>;

export function buildPath(path: string, params: QueryParams = {}): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    search.set(key, String(value));
  }

  const query = search.toString();

  return query.length > 0 ? `${path}?${query}` : path;
}

/**
 * Busca e valida a resposta com o schema informado. Retorna o tipo inferido pelo
 * zod, de modo que os hooks nunca precisam declarar generics na mao.
 */
export async function fetchJson<TSchema extends ZodTypeAny>(
  path: string,
  schema: TSchema,
  signal?: AbortSignal,
): Promise<z.infer<TSchema>> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiContractError(
      path,
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'raiz'}: ${issue.message}`),
    );
  }

  // `z.infer<TSchema>` sobre um generico colapsa para `any` aos olhos do lint.
  // O valor aqui passou pelo `safeParse` logo acima, entao e o oposto de
  // inseguro: e a unica entrada da aplicacao que valida a resposta em runtime.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return parsed.data;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (body !== null && typeof body === 'object' && 'message' in body) {
      const { message } = body as { message: unknown };

      if (typeof message === 'string') {
        return message;
      }
    }
  } catch {
    // Corpo nao-JSON (proxy fora do ar, HTML de erro): cai na mensagem padrao.
  }

  return `Falha na requisicao (${response.status})`;
}
