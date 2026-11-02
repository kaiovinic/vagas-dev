import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';

import {
  GetCandidateProfileUseCase,
} from '@/application/use-cases/get-candidate-profile.use-case';
import {
  SaveCandidateProfileUseCase,
} from '@/application/use-cases/save-candidate-profile.use-case';
import type { CandidateProfileOutput } from '@/application/use-cases/candidate-profile.output';
import { parseWithSchema } from '@/http/validation/parse-with-schema';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthSchema = z.string().regex(MONTH, 'informe o mes no formato AAAA-MM');
const optionalUrlSchema = z.string().trim().max(500).nullish();
const techsSchema = z.array(z.string().trim().min(1).max(60)).max(30).default([]);

const experienceSchema = z.object({
  company: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(200),
  startedAt: monthSchema,
  endedAt: monthSchema.nullish(),
  description: z.string().trim().min(1).max(4_000),
  techs: techsSchema,
});

const educationSchema = z.object({
  institution: z.string().trim().min(1).max(200),
  degree: z.string().trim().min(1).max(200),
  startedAt: monthSchema,
  endedAt: monthSchema.nullish(),
});

const skillGroupSchema = z.object({
  category: z.string().trim().min(1).max(100),
  items: z.array(z.string().trim().min(1).max(60)).min(1).max(40),
});

const projectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2_000),
  url: optionalUrlSchema,
  techs: techsSchema,
});

/**
 * O schema barra a forma; as invariantes de dominio (periodo invertido, url sem
 * protocolo) ficam na entidade, e chegam ao cliente como 400 pelo filtro de
 * excecao. Validar duas vezes a mesma coisa so criaria duas fontes de verdade.
 */
const saveProfileBodySchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  headline: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4_000),
  email: z.string().trim().email('informe um e-mail valido').max(200),
  city: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).nullish(),
  linkedinUrl: optionalUrlSchema,
  githubUrl: optionalUrlSchema,
  portfolioUrl: optionalUrlSchema,
  experiences: z.array(experienceSchema).max(30).default([]),
  education: z.array(educationSchema).max(20).default([]),
  skills: z.array(skillGroupSchema).max(20).default([]),
  projects: z.array(projectSchema).max(20).default([]),
});

@Controller('api/profile')
export class ProfileController {
  constructor(
    private readonly getProfile: GetCandidateProfileUseCase,
    private readonly saveProfile: SaveCandidateProfileUseCase,
  ) {}

  /** Aba `Perfil`: o perfil salvo, ou `profile: null` na primeira visita. */
  @Get()
  async get(): Promise<CandidateProfileOutput> {
    return this.getProfile.execute();
  }

  /** Upsert: a aba sempre manda o perfil inteiro, entao e PUT, nao PATCH. */
  @Put()
  async save(@Body() body: unknown): Promise<CandidateProfileOutput> {
    const input = parseWithSchema(saveProfileBodySchema, body);

    return this.saveProfile.execute({
      fullName: input.fullName,
      headline: input.headline,
      summary: input.summary,
      email: input.email,
      city: input.city,
      phone: input.phone ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      githubUrl: input.githubUrl ?? null,
      portfolioUrl: input.portfolioUrl ?? null,
      experiences: input.experiences.map((entry) => ({ ...entry, endedAt: entry.endedAt ?? null })),
      education: input.education.map((entry) => ({ ...entry, endedAt: entry.endedAt ?? null })),
      skills: input.skills,
      projects: input.projects.map((entry) => ({ ...entry, url: entry.url ?? null })),
    });
  }
}
