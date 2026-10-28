import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { ApiError, fetchJson } from '@/api/http';
import {
  publicRulesSchema,
  rulesTestResultSchema,
  type PublicRules,
  type RulesTestResult,
} from '@/api/schemas';

/** As regras mudam junto com um deploy, nao a cada captura. */
export const RULES_STALE_TIME_MS = 60 * 60_000;

export const rulesQueryKey = ['rules'] as const;

export function useRules(): UseQueryResult<PublicRules, Error> {
  return useQuery({
    queryKey: rulesQueryKey,
    queryFn: ({ signal }) => fetchJson('/api/rules', publicRulesSchema, signal),
    staleTime: RULES_STALE_TIME_MS,
  });
}

export interface TestRulesInput {
  readonly text: string;
  readonly company?: string | undefined;
  readonly url?: string | undefined;
  readonly location?: string | undefined;
}

export function useTestRules(): UseMutationResult<RulesTestResult, Error, TestRulesInput> {
  return useMutation({
    mutationFn: (input: TestRulesInput) => postRulesTest(input),
  });
}

async function postRulesTest(input: TestRulesInput): Promise<RulesTestResult> {
  const response = await fetch('/api/rules/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(stripEmpty(input)),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(readMessage(payload, response.status), response.status);
  }

  return rulesTestResultSchema.parse(payload);
}

/** A API recusa campos vazios; so vai o que o usuario realmente preencheu. */
function stripEmpty(input: TestRulesInput): Record<string, string> {
  const entries = Object.entries(input).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[1].trim().length > 0,
  );

  return Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]));
}

function readMessage(payload: unknown, status: number): string {
  if (payload !== null && typeof payload === 'object' && 'message' in payload) {
    const { message } = payload as { message: unknown };

    if (typeof message === 'string') {
      return message;
    }
  }

  return `Falha ao validar a publicacao (${status})`;
}
