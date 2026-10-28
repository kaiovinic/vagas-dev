import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';

import {
  TestJobRulesUseCase,
  type TestJobRulesOutput,
} from '@/application/use-cases/test-job-rules.use-case';
import { JOB_WORK_MODELS } from '@/domain/entities/job';
import type { PublicJobRules } from '@/domain/services/job-rule-engine';
import { parseWithSchema } from '@/http/validation/parse-with-schema';

const testRulesBodySchema = z
  .object({
    text: z.string().max(20_000).optional(),
    company: z.string().trim().max(200).optional(),
    url: z.string().trim().max(2_000).optional(),
    location: z.string().trim().max(200).optional(),
    workModel: z.enum(JOB_WORK_MODELS).optional(),
    publishedAt: z.coerce.date().optional(),
  })
  .refine(
    (body) => (body.text?.trim().length ?? 0) > 0 || (body.url?.length ?? 0) > 0,
    { message: 'informe o texto ou o link da vaga', path: ['text'] },
  );

@Controller('api/rules')
export class RulesController {
  constructor(private readonly rules: TestJobRulesUseCase) {}

  /** Aba publica de transparencia: todos os criterios do filtro. */
  @Get()
  getPublicRules(): PublicJobRules {
    return this.rules.getPublicRules();
  }

  /** Testa se um texto ou link de vaga passaria no filtro, com o motivo de cada reprovacao. */
  @Post('test')
  @HttpCode(200)
  testRules(@Body() body: unknown): TestJobRulesOutput {
    const input = parseWithSchema(testRulesBodySchema, body);

    return this.rules.execute({
      text: input.text ?? '',
      company: input.company,
      url: input.url,
      location: input.location,
      workModel: input.workModel,
      publishedAt: input.publishedAt,
    });
  }
}
