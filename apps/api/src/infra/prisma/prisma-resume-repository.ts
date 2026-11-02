import { Injectable } from '@nestjs/common';

import type { GeneratedResumeContent, ResumeTargetJob } from '@/domain/providers/resume-generator';
import type {
  IResumeRepository,
  IResumeTargetJobReader,
  StoredResume,
} from '@/domain/repositories/resume-repository';
import { PrismaService } from '@/infra/prisma/prisma.service';

/** A linha do curriculo gerado, como o Prisma a devolve. */
interface ResumeRow {
  readonly id: string;
  readonly jobId: string;
  readonly markdown: string;
  readonly rationale: string[];
  readonly gaps: string[];
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly createdAt: Date;
}

/**
 * Historico das geracoes e leitura da vaga alvo.
 *
 * As duas coisas moram na mesma classe porque sao a mesma consulta de um lado e
 * do outro da relacao, mas cada caso de uso recebe so o contrato de que precisa
 * (ISP) — a listagem da aba `Vagas` segue com o seu proprio repositorio.
 */
@Injectable()
export class PrismaResumeRepository implements IResumeRepository, IResumeTargetJobReader {
  constructor(private readonly prisma: PrismaService) {}

  async findById(jobId: string): Promise<ResumeTargetJob | null> {
    const row = await this.prisma.job.findUnique({ where: { id: jobId } });

    if (row === null) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      company: row.company,
      description: row.description,
      tags: row.tags,
      workModel: row.workModel,
      location: row.city ?? '',
      url: row.url,
    };
  }

  async save(jobId: string, content: GeneratedResumeContent): Promise<StoredResume> {
    const row = await this.prisma.generatedResume.create({
      data: {
        jobId,
        markdown: content.markdown,
        rationale: [...content.rationale],
        gaps: [...content.gaps],
        model: content.usage.model,
        inputTokens: content.usage.inputTokens,
        outputTokens: content.usage.outputTokens,
      },
    });

    return toStored(row);
  }

  async findLatestByJob(jobId: string): Promise<StoredResume | null> {
    const row = await this.prisma.generatedResume.findFirst({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
    });

    return row === null ? null : toStored(row);
  }
}

function toStored(row: ResumeRow): StoredResume {
  return { ...row };
}
