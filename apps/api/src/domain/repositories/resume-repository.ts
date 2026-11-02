import type { GeneratedResumeContent, ResumeTargetJob } from '@/domain/providers/resume-generator';

export const RESUME_TARGET_JOB_READER = Symbol.for('RESUME_TARGET_JOB_READER');
export const RESUME_REPOSITORY = Symbol.for('RESUME_REPOSITORY');

/**
 * Leitura da vaga alvo (ISP).
 *
 * A listagem da aba `Vagas` nao serve aqui: ela pagina, filtra e ordena, e o
 * gerador quer uma vaga so, pelo id. Contrato proprio, metodo unico.
 */
export interface IResumeTargetJobReader {
  findById(jobId: string): Promise<ResumeTargetJob | null>;
}

/** Um curriculo ja gerado, como o historico o guarda. */
export interface StoredResume {
  readonly id: string;
  readonly jobId: string;
  readonly markdown: string;
  readonly rationale: readonly string[];
  readonly gaps: readonly string[];
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly createdAt: Date;
}

/**
 * Historico das geracoes.
 *
 * Nao e luxo: e o que permite comparar o que foi enviado com o retorno que a
 * vaga deu, e o que evita pagar duas vezes pela mesma vaga sem querer.
 */
export interface IResumeRepository {
  save(jobId: string, content: GeneratedResumeContent): Promise<StoredResume>;
  findLatestByJob(jobId: string): Promise<StoredResume | null>;
}
