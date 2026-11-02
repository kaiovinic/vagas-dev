import type { CandidateProfile } from '@/domain/entities/candidate-profile';
import type { JobWorkModel } from '@/domain/entities/job';

export const RESUME_GENERATOR = Symbol.for('RESUME_GENERATOR');

/** A vaga alvo, com o que o curriculo precisa saber dela — e nada alem. */
export interface ResumeTargetJob {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly workModel: JobWorkModel;
  readonly location: string;
  readonly url: string;
}

export interface ResumeRequest {
  readonly profile: CandidateProfile;
  readonly job: ResumeTargetJob;
}

/** Consumo da geracao, para o historico dizer quanto custou cada curriculo. */
export interface ResumeUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Tokens servidos do cache: e o que mostra se o prefixo estavel esta valendo. */
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
}

export interface GeneratedResumeContent {
  readonly markdown: string;
  /** Por que o modelo destacou cada bloco: vira a aba "Como foi montado". */
  readonly rationale: readonly string[];
  /** Requisitos da vaga que o perfil NAO cobre — a parte mais util do retorno. */
  readonly gaps: readonly string[];
  readonly usage: ResumeUsage;
}

/**
 * Porta do gerador de curriculo.
 *
 * Isola o provedor de IA do resto do sistema: trocar de provedor, ou dublar no
 * teste, e implementar esta interface. Como nos coletores, a implementacao nao
 * deixa vazar excecao do SDK — falha vira erro de dominio tipado, e quem chama
 * decide o que o painel ve.
 */
export interface IResumeGenerator {
  generate(request: ResumeRequest): Promise<GeneratedResumeContent>;
}
