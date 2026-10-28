import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError } from '@/api/http';

export const captureRunSchema = z.object({
  captureId: z.string(),
  status: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  nextRunAt: z.string().datetime(),
  totalFound: z.number(),
  totalApproved: z.number(),
  totalPersisted: z.number(),
  totalDuplicated: z.number(),
  failedSources: z.array(z.string()),
  joinedRunning: z.boolean(),
});

export type CaptureRun = z.infer<typeof captureRunSchema>;

/**
 * Dispara uma captura manual. Ao terminar, invalida tudo que depende das vagas
 * para a tela refletir o resultado sem recarregar a pagina.
 */
export function useRunCapture(): UseMutationResult<CaptureRun, Error, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postCaptureRun,
    onSuccess: async () => {
      await Promise.all(
        [['dashboard'], ['jobs'], ['market']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

async function postCaptureRun(): Promise<CaptureRun> {
  const response = await fetch('/api/capture/run', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(readMessage(payload, response.status), response.status);
  }

  return captureRunSchema.parse(payload);
}

function readMessage(payload: unknown, status: number): string {
  if (payload !== null && typeof payload === 'object' && 'message' in payload) {
    const { message } = payload as { message: unknown };

    if (typeof message === 'string') {
      return message;
    }
  }

  return `Falha ao capturar vagas (${status})`;
}
