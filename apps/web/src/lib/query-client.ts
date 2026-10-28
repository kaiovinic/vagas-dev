import { QueryClient } from '@tanstack/react-query';

import { ApiContractError, ApiError } from '@/api/http';

const DEFAULT_STALE_TIME_MS = 30_000;
const MAX_RETRIES = 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: (failureCount, error) => failureCount < MAX_RETRIES && isRetryable(error),
      },
    },
  });
}

/** Erro de contrato ou 4xx nao melhora com repeticao; so 5xx e falha de rede. */
function isRetryable(error: unknown): boolean {
  if (error instanceof ApiContractError) {
    return false;
  }

  if (error instanceof ApiError) {
    return error.status >= 500;
  }

  return true;
}
