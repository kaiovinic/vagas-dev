import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { ApiError, fetchJson } from '@/api/http';
import {
  candidateProfileResponseSchema,
  type CandidateProfile,
  type CandidateProfileResponse,
} from '@/api/schemas';

export const candidateProfileQueryKey = ['profile'] as const;

/** O perfil muda quando o usuario o edita, nao a cada captura. */
export const PROFILE_STALE_TIME_MS = 60 * 60_000;

export function useCandidateProfile(): UseQueryResult<CandidateProfileResponse, Error> {
  return useQuery({
    queryKey: candidateProfileQueryKey,
    queryFn: ({ signal }) => fetchJson('/api/profile', candidateProfileResponseSchema, signal),
    staleTime: PROFILE_STALE_TIME_MS,
  });
}

/**
 * Upsert do perfil. O retorno do PUT ja e a resposta completa da aba, entao ele
 * entra direto no cache: nao ha motivo para um GET seguido logo depois.
 */
export function useSaveCandidateProfile(): UseMutationResult<
  CandidateProfileResponse,
  Error,
  CandidateProfile
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: putProfile,
    onSuccess: (response) => {
      queryClient.setQueryData(candidateProfileQueryKey, response);
    },
  });
}

async function putProfile(profile: CandidateProfile): Promise<CandidateProfileResponse> {
  const response = await fetch('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(profile),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(readMessage(payload, response.status), response.status);
  }

  return candidateProfileResponseSchema.parse(payload);
}

function readMessage(payload: unknown, status: number): string {
  if (payload !== null && typeof payload === 'object' && 'message' in payload) {
    const { message } = payload as { message: unknown };

    if (typeof message === 'string') {
      return message;
    }
  }

  return `Falha ao salvar o perfil (${status})`;
}
