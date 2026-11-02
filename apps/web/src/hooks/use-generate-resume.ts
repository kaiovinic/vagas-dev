import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { postJson } from '@/api/http';
import { generatedResumeSchema, type GeneratedResume } from '@/api/schemas';

export interface GenerateResumeVariables {
  readonly jobId: string;
  /** Verdadeiro no botao "gerar outra versao": sem isso a API reaproveita. */
  readonly regenerate?: boolean;
}

/**
 * Geracao sob demanda, nunca em lote: cada chamada custa dinheiro.
 *
 * Mutation, e nao query, justamente por isso — nada aqui dispara sozinho ao
 * montar a tela, nem refaz a chamada ao voltar o foco da janela.
 */
export function useGenerateResume(): UseMutationResult<
  GeneratedResume,
  Error,
  GenerateResumeVariables
> {
  return useMutation({
    mutationFn: ({ jobId, regenerate = false }) =>
      postJson('/api/resume/generate', { jobId, regenerate }, generatedResumeSchema),
  });
}
