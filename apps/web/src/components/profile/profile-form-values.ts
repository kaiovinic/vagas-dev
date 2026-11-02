import { z } from 'zod';

import type { CandidateProfile } from '@/api/schemas';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_MESSAGE = 'Use o formato AAAA-MM';

const monthSchema = z.string().trim().regex(MONTH_PATTERN, MONTH_MESSAGE);
/** Vazio significa "ainda estou aqui" / "em curso", nao erro de preenchimento. */
const openMonthSchema = z
  .string()
  .trim()
  .refine((value) => value.length === 0 || MONTH_PATTERN.test(value), MONTH_MESSAGE);

const required = (label: string) => z.string().trim().min(1, `Informe ${label}`);

export const profileFormSchema = z.object({
  fullName: required('o nome completo'),
  headline: required('o titulo profissional'),
  summary: required('o resumo profissional'),
  email: z.string().trim().email('Informe um e-mail valido'),
  city: required('a cidade'),
  phone: z.string().trim().max(40),
  linkedinUrl: z.string().trim(),
  githubUrl: z.string().trim(),
  portfolioUrl: z.string().trim(),
  experiences: z.array(
    z.object({
      company: required('a empresa'),
      role: required('o cargo'),
      startedAt: monthSchema,
      endedAt: openMonthSchema,
      description: required('o que voce fez'),
      techs: z.string().trim(),
    }),
  ),
  education: z.array(
    z.object({
      institution: required('a instituicao'),
      degree: required('o curso'),
      startedAt: monthSchema,
      endedAt: openMonthSchema,
    }),
  ),
  skills: z.array(
    z.object({
      category: required('a categoria'),
      items: required('ao menos uma competencia'),
    }),
  ),
  projects: z.array(
    z.object({
      name: required('o nome do projeto'),
      description: required('a descricao'),
      url: z.string().trim(),
      techs: z.string().trim(),
    }),
  ),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export const EMPTY_EXPERIENCE: ProfileFormValues['experiences'][number] = {
  company: '',
  role: '',
  startedAt: '',
  endedAt: '',
  description: '',
  techs: '',
};

export const EMPTY_EDUCATION: ProfileFormValues['education'][number] = {
  institution: '',
  degree: '',
  startedAt: '',
  endedAt: '',
};

export const EMPTY_SKILL_GROUP: ProfileFormValues['skills'][number] = { category: '', items: '' };

export const EMPTY_PROJECT: ProfileFormValues['projects'][number] = {
  name: '',
  description: '',
  url: '',
  techs: '',
};

export const EMPTY_FORM: ProfileFormValues = {
  fullName: '',
  headline: '',
  summary: '',
  email: '',
  city: '',
  phone: '',
  linkedinUrl: '',
  githubUrl: '',
  portfolioUrl: '',
  experiences: [],
  education: [],
  skills: [],
  projects: [],
};

/** O perfil salvo vira formulario: nulo e lista de techs viram texto editavel. */
export function toFormValues(profile: CandidateProfile | null): ProfileFormValues {
  if (profile === null) {
    return EMPTY_FORM;
  }

  return {
    fullName: profile.fullName,
    headline: profile.headline,
    summary: profile.summary,
    email: profile.email,
    city: profile.city,
    phone: profile.phone ?? '',
    linkedinUrl: profile.linkedinUrl ?? '',
    githubUrl: profile.githubUrl ?? '',
    portfolioUrl: profile.portfolioUrl ?? '',
    experiences: profile.experiences.map((entry) => ({
      ...entry,
      endedAt: entry.endedAt ?? '',
      techs: entry.techs.join(', '),
    })),
    education: profile.education.map((entry) => ({ ...entry, endedAt: entry.endedAt ?? '' })),
    skills: profile.skills.map((entry) => ({ ...entry, items: entry.items.join(', ') })),
    projects: profile.projects.map((entry) => ({
      ...entry,
      url: entry.url ?? '',
      techs: entry.techs.join(', '),
    })),
  };
}

/** O formulario vira o corpo do PUT: campo vazio e ausencia, nao string vazia. */
export function toProfilePayload(values: ProfileFormValues): CandidateProfile {
  return {
    fullName: values.fullName.trim(),
    headline: values.headline.trim(),
    summary: values.summary.trim(),
    email: values.email.trim(),
    city: values.city.trim(),
    phone: orNull(values.phone),
    linkedinUrl: orNull(values.linkedinUrl),
    githubUrl: orNull(values.githubUrl),
    portfolioUrl: orNull(values.portfolioUrl),
    experiences: values.experiences.map((entry) => ({
      company: entry.company.trim(),
      role: entry.role.trim(),
      startedAt: entry.startedAt.trim(),
      endedAt: orNull(entry.endedAt),
      description: entry.description.trim(),
      techs: toList(entry.techs),
    })),
    education: values.education.map((entry) => ({
      institution: entry.institution.trim(),
      degree: entry.degree.trim(),
      startedAt: entry.startedAt.trim(),
      endedAt: orNull(entry.endedAt),
    })),
    skills: values.skills.map((entry) => ({
      category: entry.category.trim(),
      items: toList(entry.items),
    })),
    projects: values.projects.map((entry) => ({
      name: entry.name.trim(),
      description: entry.description.trim(),
      url: orNull(entry.url),
      techs: toList(entry.techs),
    })),
  };
}

function orNull(value: string): string | null {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/** Lista separada por virgula: e como as pessoas escrevem stack, naturalmente. */
function toList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
