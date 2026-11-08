import { z } from 'zod';

/**
 * Schemas espelhando os contratos da API. Validar a resposta em runtime mantem a
 * tipagem estrita de ponta a ponta: uma mudanca no backend falha aqui, com
 * mensagem clara, em vez de virar `undefined` no meio de um grafico.
 */

export const captureStatusSchema = z.enum(['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED']);

export const jobScopeSchema = z.enum(['NATIONAL', 'INTERNATIONAL', 'UNKNOWN']);

export const workModelSchema = z.enum(['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN']);

export const dashboardSummarySchema = z.object({
  windowInHours: z.number(),
  capture: z.object({
    lastCaptureAt: z.string().datetime().nullable(),
    nextCaptureAt: z.string().datetime().nullable(),
    status: captureStatusSchema.nullable(),
    failedSources: z.array(z.string()),
  }),
  openJobs: z.object({ total: z.number() }),
  newInLast24h: z.object({
    total: z.number(),
    previousTotal: z.number(),
    delta: z.number(),
  }),
  remote: z.object({ total: z.number(), percentage: z.number() }),
  hiringCompanies: z.object({ total: z.number() }),
});

export const sourceSliceSchema = z.object({
  source: z.string(),
  total: z.number(),
  percentage: z.number(),
});

export const dashboardChartsSchema = z.object({
  days: z.number(),
  windowInHours: z.number(),
  sources: z.array(z.string()),
  openJobsBySource: z.array(sourceSliceSchema),
  newJobsByDay: z.array(
    z.object({
      day: z.string(),
      total: z.number(),
      sources: z.array(sourceSliceSchema),
    }),
  ),
  captureBlockInHours: z.number(),
  capturesTimeline: z.array(
    z.object({
      label: z.string(),
      count: z.number(),
      start: z.string().datetime(),
    }),
  ),
});

export const jobListItemSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  title: z.string(),
  company: z.string(),
  recruiterName: z.string().nullable(),
  source: z.string(),
  city: z.string().nullable(),
  isRemote: z.boolean(),
  scope: jobScopeSchema,
  workModel: workModelSchema,
  url: z.string(),
  tags: z.array(z.string()),
  description: z.string(),
  publishedAt: z.string().datetime(),
  publishedAtSource: z.enum(['SOURCE', 'CAPTURE']),
});

export const jobsListSchema = z.object({
  items: z.array(jobListItemSchema),
  total: z.number(),
  page: z.number(),
  perPage: z.number(),
  totalPages: z.number(),
});

export const hiringEntitySchema = z.object({
  name: z.string(),
  total: z.number(),
  remoteTotal: z.number(),
  lastPublishedAt: z.string().datetime(),
});

export const hiringEntityListSchema = z.array(hiringEntitySchema);

export const rejectionReasonSchema = z.enum([
  'EXPIRED_PUBLICATION',
  'STACK_NOT_MATCHED',
  'LOCATION_NOT_ALLOWED',
  'SPAM_DETECTED',
]);

export const rulesTestResultSchema = z.object({
  approved: z.boolean(),
  rejectionReasons: z.array(rejectionReasonSchema),
  matchedStack: z.array(z.string()),
  matchedLocations: z.array(z.string()),
  matchedSpamTerms: z.array(z.string()),
  evaluated: z.object({
    title: z.string(),
    company: z.string(),
    location: z.string(),
    workModel: workModelSchema,
    publishedAt: z.string().datetime(),
    url: z.string(),
  }),
});

export const marketSliceSchema = z.object({
  id: z.string(),
  label: z.string(),
  total: z.number(),
  percentage: z.number(),
});

export const marketInsightsSchema = z.object({
  windowInHours: z.number(),
  openJobs: z.number(),
  technologies: z.array(marketSliceSchema),
  seniorities: z.array(marketSliceSchema),
  workModels: z.array(marketSliceSchema),
  scopes: z.array(marketSliceSchema),
  seniorityNotInformed: marketSliceSchema,
});

export const publicRulesSchema = z.object({
  version: z.string(),
  publicationWindowInHours: z.number(),
  rules: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      kind: z.string(),
      criteria: z.array(z.string()),
      rejectionReason: z.string(),
    }),
  ),
});

export type CaptureStatus = z.infer<typeof captureStatusSchema>;
export type JobScope = z.infer<typeof jobScopeSchema>;
export type WorkModel = z.infer<typeof workModelSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type DashboardCharts = z.infer<typeof dashboardChartsSchema>;
export type SourceSlice = z.infer<typeof sourceSliceSchema>;
export type DailyStack = DashboardCharts['newJobsByDay'][number];
export type CaptureBlock = DashboardCharts['capturesTimeline'][number];
export type JobListItem = z.infer<typeof jobListItemSchema>;
export type JobsList = z.infer<typeof jobsListSchema>;
export type HiringEntity = z.infer<typeof hiringEntitySchema>;
export type PublicRules = z.infer<typeof publicRulesSchema>;
export type MarketSlice = z.infer<typeof marketSliceSchema>;
export type MarketInsights = z.infer<typeof marketInsightsSchema>;
export type PublicRule = PublicRules['rules'][number];
export type RejectionReason = z.infer<typeof rejectionReasonSchema>;
export type RulesTestResult = z.infer<typeof rulesTestResultSchema>;

/**
 * `INACTIVE` e `UNCONFIGURED` nasceram de um incidente: um endpoint vazio no
 * container deixou o coletor de publicacoes cinco dias fora do ar, e a tabela
 * o mostrava verde — ele nao falhava, so nunca era visitado.
 */
export const sourceStatusSchema = z.enum([
  'OK',
  'FAILING',
  'IDLE',
  'INACTIVE',
  'UNCONFIGURED',
]);

export const sourceHealthRowSchema = z.object({
  source: z.string(),
  status: sourceStatusSchema,
  lastRunAt: z.string().datetime().nullable(),
  nextRunAt: z.string().datetime().nullable(),
  intervalInHours: z.number(),
  runs: z.number(),
  failures: z.number(),
  totalFound: z.number(),
});

export const sourceHealthSchema = z.object({
  windowInHours: z.number(),
  sources: z.array(sourceHealthRowSchema),
});

export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type SourceHealthRow = z.infer<typeof sourceHealthRowSchema>;
export type SourceHealth = z.infer<typeof sourceHealthSchema>;

const profileMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const profileExperienceSchema = z.object({
  company: z.string(),
  role: z.string(),
  startedAt: profileMonthSchema,
  endedAt: profileMonthSchema.nullable(),
  description: z.string(),
  techs: z.array(z.string()),
});

export const profileEducationSchema = z.object({
  institution: z.string(),
  degree: z.string(),
  startedAt: profileMonthSchema,
  endedAt: profileMonthSchema.nullable(),
});

export const profileSkillGroupSchema = z.object({
  category: z.string(),
  items: z.array(z.string()),
});

export const profileProjectSchema = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string().nullable(),
  techs: z.array(z.string()),
});

export const candidateProfileSchema = z.object({
  fullName: z.string(),
  headline: z.string(),
  summary: z.string(),
  email: z.string(),
  city: z.string(),
  phone: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  githubUrl: z.string().nullable(),
  portfolioUrl: z.string().nullable(),
  experiences: z.array(profileExperienceSchema),
  education: z.array(profileEducationSchema),
  skills: z.array(profileSkillGroupSchema),
  projects: z.array(profileProjectSchema),
});

/** `profile: null` e a primeira visita da aba, nao erro. */
export const candidateProfileResponseSchema = z.object({
  profile: candidateProfileSchema.nullable(),
  isUsableForResume: z.boolean(),
});

export type ProfileExperience = z.infer<typeof profileExperienceSchema>;
export type ProfileEducation = z.infer<typeof profileEducationSchema>;
export type ProfileSkillGroup = z.infer<typeof profileSkillGroupSchema>;
export type ProfileProject = z.infer<typeof profileProjectSchema>;
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
export type CandidateProfileResponse = z.infer<typeof candidateProfileResponseSchema>;

/** Curriculo gerado para uma vaga. `generated: false` veio do historico. */
export const generatedResumeSchema = z.object({
  markdown: z.string(),
  rationale: z.array(z.string()),
  gaps: z.array(z.string()),
  model: z.string(),
  generatedAt: z.string(),
  generated: z.boolean(),
});

export type GeneratedResume = z.infer<typeof generatedResumeSchema>;

