import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import {
  ListJobsUseCase,
  MAX_PER_PAGE,
  type ListJobsOutput,
} from '@/application/use-cases/list-jobs.use-case';
import type { HiringEntityCount } from '@/domain/repositories/job-query-repository';
import { JOB_SENIORITY_LEVELS } from '@/domain/services/job-seniority';
import { JOB_SCOPES } from '@/domain/services/job-scope';
import { parseWithSchema } from '@/http/validation/parse-with-schema';

const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const text = z.string().trim().min(1).optional();

/** `tech=React,Node.js` — lista separada por virgula, como o formulario envia. */
const technologyList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((technology) => technology.trim())
      .filter((technology) => technology.length > 0),
  );

const listJobsQuerySchema = z.object({
  search: text,
  tech: technologyList,
  seniority: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((level) => level.trim().toUpperCase())
        .filter((level) => level.length > 0),
    )
    .pipe(z.array(z.enum(JOB_SENIORITY_LEVELS))),
  source: text,
  company: text,
  recruiterName: text,
  city: text,
  isRemote: booleanFlag,
  includeExpired: booleanFlag,
  /** Recorte temporal da barra de controle: 1, 6, 24, 48 ou 72 horas. */
  withinHours: z.coerce.number().int().min(1).max(72).optional(),
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(MAX_PER_PAGE).optional(),
  scope: z.enum(JOB_SCOPES).optional(),
  sortBy: z.enum(['publishedAt', 'company', 'title']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

@Controller('api/jobs')
export class JobsController {
  constructor(private readonly jobs: ListJobsUseCase) {}

  /** Aba `Vagas`: listagem paginada e filtravel, limitada as ultimas 72h por padrao. */
  @Get()
  async list(@Query() query: unknown): Promise<ListJobsOutput> {
    const { tech, seniority, ...filters } = parseWithSchema(listJobsQuerySchema, query);

    return this.jobs.execute({ ...filters, technologies: tech, seniorities: seniority });
  }

  /** Aba `Empresas`: empresas contratando nas ultimas 72h. */
  @Get('companies')
  async listCompanies(): Promise<HiringEntityCount[]> {
    return this.jobs.listCompanies();
  }

  /** Aba `Recrutadores`: quem publicou vagas nas ultimas 72h. */
  @Get('recruiters')
  async listRecruiters(): Promise<HiringEntityCount[]> {
    return this.jobs.listRecruiters();
  }
}
