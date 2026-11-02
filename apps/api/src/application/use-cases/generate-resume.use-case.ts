import { Inject, Injectable, Logger } from '@nestjs/common';

import type { CandidateProfile } from '@/domain/entities/candidate-profile';

import {
  CANDIDATE_PROFILE_READER,
  type ICandidateProfileReader,
} from '@/domain/repositories/candidate-profile-repository';
import {
  ProfileNotReadyForResumeError,
  ResumeTargetNotFoundError,
} from '@/domain/errors/resume-errors';
import {
  RESUME_GENERATOR,
  type IResumeGenerator,
} from '@/domain/providers/resume-generator';
import {
  RESUME_REPOSITORY,
  RESUME_TARGET_JOB_READER,
  type IResumeRepository,
  type IResumeTargetJobReader,
  type StoredResume,
} from '@/domain/repositories/resume-repository';

export interface GenerateResumeInput {
  readonly jobId: string;
  /** Gerar de novo mesmo havendo versao salva: o botao "gerar outra vez". */
  readonly regenerate?: boolean;
}

export interface GenerateResumeOutput {
  readonly resume: StoredResume;
  /** Falso quando a resposta veio do historico, sem gastar token. */
  readonly generated: boolean;
}

/**
 * Gera o curriculo de uma vaga.
 *
 * A ordem das verificacoes e deliberada: vaga, historico e perfil antes da
 * chamada paga. Aproveitar a ultima versao salva e o que evita pagar duas vezes
 * pela mesma vaga sem querer — a tela pede de novo so quando o usuario clica.
 */
@Injectable()
export class GenerateResumeUseCase {
  private readonly logger = new Logger(GenerateResumeUseCase.name);

  constructor(
    @Inject(RESUME_TARGET_JOB_READER) private readonly jobs: IResumeTargetJobReader,
    @Inject(CANDIDATE_PROFILE_READER) private readonly profiles: ICandidateProfileReader,
    @Inject(RESUME_GENERATOR) private readonly generator: IResumeGenerator,
    @Inject(RESUME_REPOSITORY) private readonly resumes: IResumeRepository,
  ) {}

  async execute({ jobId, regenerate = false }: GenerateResumeInput): Promise<GenerateResumeOutput> {
    const job = await this.jobs.findById(jobId);

    if (job === null) {
      throw new ResumeTargetNotFoundError(jobId);
    }

    const stored = regenerate ? null : await this.resumes.findLatestByJob(jobId);

    if (stored !== null) {
      return { resume: stored, generated: false };
    }

    const profile = await this.requireUsableProfile();
    const content = await this.generator.generate({ profile, job });

    this.logger.log(
      `Curriculo gerado para ${job.title} (${job.company}): ` +
        `${content.usage.inputTokens} tokens de entrada, ${content.usage.outputTokens} de saida, ` +
        `${content.usage.cacheReadTokens} servidos do cache`,
    );

    return { resume: await this.resumes.save(jobId, content), generated: true };
  }

  private async requireUsableProfile(): Promise<CandidateProfile> {
    const profile = await this.profiles.find();

    if (profile === null) {
      throw new ProfileNotReadyForResumeError('Preencha a aba Perfil antes de gerar curriculo');
    }

    if (!profile.isUsableForResume) {
      throw new ProfileNotReadyForResumeError(
        'O perfil precisa de ao menos uma experiencia e um grupo de competencias',
      );
    }

    return profile;
  }
}
