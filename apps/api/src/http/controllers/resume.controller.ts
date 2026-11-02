import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';

import { GenerateResumeUseCase } from '@/application/use-cases/generate-resume.use-case';
import { parseWithSchema } from '@/http/validation/parse-with-schema';

const generateResumeBodySchema = z.object({
  jobId: z.string().trim().min(1).max(100),
  /** O botao "gerar outra vez": sem ele, a ultima versao salva e reaproveitada. */
  regenerate: z.boolean().default(false),
});

export interface GenerateResumeResponse {
  readonly markdown: string;
  readonly rationale: readonly string[];
  readonly gaps: readonly string[];
  readonly model: string;
  readonly generatedAt: string;
  /** Falso quando a resposta veio do historico, sem gastar token. */
  readonly generated: boolean;
}

@Controller('api/resume')
export class ResumeController {
  constructor(private readonly generateResume: GenerateResumeUseCase) {}

  @Post('generate')
  async generate(@Body() body: unknown): Promise<GenerateResumeResponse> {
    const input = parseWithSchema(generateResumeBodySchema, body);
    const { resume, generated } = await this.generateResume.execute(input);

    return {
      markdown: resume.markdown,
      rationale: resume.rationale,
      gaps: resume.gaps,
      model: resume.model,
      generatedAt: resume.createdAt.toISOString(),
      generated,
    };
  }
}
