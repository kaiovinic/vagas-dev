import type { CandidateProfile, ProfileExperience } from '@/domain/entities/candidate-profile';
import type { JobWorkModel } from '@/domain/entities/job';
import { ProfileNotReadyForResumeError } from '@/domain/errors/resume-errors';
import type { ResumeRequest, ResumeTargetJob } from '@/domain/providers/resume-generator';

/**
 * Teto da descricao da vaga.
 *
 * Anuncio de 40 mil caracteres existe — quase sempre com pagina inteira de
 * "quem somos" e beneficios. O que decide o curriculo esta no inicio, e cortar
 * aqui mantem o custo por geracao previsivel.
 */
export const MAX_JOB_DESCRIPTION_CHARS = 8_000;

/** Os tres blocos do pedido, na ordem que o cache espera. */
export interface ResumePrompt {
  /** Regras do jogo: identico em toda geracao, primeiro breakpoint de cache. */
  readonly rules: string;
  /** O historico do candidato: estavel ate ele editar a aba Perfil. */
  readonly profile: string;
  /** A vaga alvo: a unica parte volatil do pedido. */
  readonly job: string;
}

export const RESUME_RULES = [
  'Voce escreve curriculos em portugues do Brasil, sob medida para uma vaga.',
  '',
  'Regras absolutas:',
  '1. Use SOMENTE fatos presentes no perfil do candidato. Nunca invente empresa,',
  '   cargo, tecnologia, numero, periodo, formacao ou projeto.',
  '2. Nunca infle senioridade: se o perfil nao diz "senior", o curriculo nao diz.',
  '3. Nao preencha lacuna com suposicao. Requisito da vaga que o perfil nao cobre',
  '   vai para "gaps", nunca para o curriculo.',
  '4. Selecionar, ordenar e reescrever e o seu trabalho: destaque o que a vaga pede,',
  '   usando o vocabulario do anuncio quando ele descrever a mesma coisa que o perfil.',
  '5. O Markdown comeca pelo nome e contatos, e segue com resumo, experiencia,',
  '   competencias, projetos e formacao. Sem titulo de documento, sem comentarios.',
  '',
  'Formato da resposta:',
  '- markdown: o curriculo completo.',
  '- rationale: por que cada bloco foi destacado ou deixado de lado.',
  '- gaps: requisitos da vaga que o perfil nao cobre, do mais ao menos grave.',
].join('\n');

/**
 * Monta o prompt a partir do perfil e da vaga.
 *
 * Servico de dominio puro: nenhuma chamada de rede, nenhum acesso a banco. Por
 * isso ele e o lugar certo para recusar um perfil inutilizavel — antes de a
 * infraestrutura gastar o primeiro token.
 */
export class ResumePromptBuilder {
  build({ profile, job }: ResumeRequest): ResumePrompt {
    if (!profile.isUsableForResume) {
      throw new ProfileNotReadyForResumeError(
        'O perfil precisa de ao menos uma experiencia e um grupo de competencias',
      );
    }

    return { rules: RESUME_RULES, profile: describeProfile(profile), job: describeJob(job) };
  }
}

function describeProfile(profile: CandidateProfile): string {
  return [
    '# Perfil do candidato',
    '',
    `Nome: ${profile.fullName}`,
    `Titulo: ${profile.headline}`,
    `Cidade: ${profile.city}`,
    ...contactLines(profile),
    '',
    '## Resumo base',
    profile.summary,
    ...experienceSection(profile),
    ...skillSection(profile),
    ...projectSection(profile),
    ...educationSection(profile),
  ].join('\n');
}

function contactLines(profile: CandidateProfile): string[] {
  const contacts: ReadonlyArray<readonly [string, string | null]> = [
    ['E-mail', profile.email],
    ['Telefone', profile.phone],
    ['LinkedIn', profile.linkedinUrl],
    ['GitHub', profile.githubUrl],
    ['Portfolio', profile.portfolioUrl],
  ];

  return contacts
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    .map(([label, value]) => `${label}: ${value}`);
}

function experienceSection(profile: CandidateProfile): string[] {
  return [
    '',
    '## Experiencia',
    ...profile.experiences.flatMap((entry) => [
      `- ${entry.role} na ${entry.company} (${describePeriod(entry)})`,
      `  Tecnologias: ${entry.techs.join(', ')}`,
      `  ${entry.description}`,
    ]),
  ];
}

/** "Atual" em vez de vazio: o modelo precisa saber qual emprego ainda vale. */
function describePeriod(entry: Pick<ProfileExperience, 'startedAt' | 'endedAt'>): string {
  return `${entry.startedAt} a ${entry.endedAt ?? 'atual'}`;
}

function skillSection(profile: CandidateProfile): string[] {
  return [
    '',
    '## Competencias',
    ...profile.skills.map((group) => `- ${group.category}: ${group.items.join(', ')}`),
  ];
}

function projectSection(profile: CandidateProfile): string[] {
  if (profile.projects.length === 0) {
    return [];
  }

  return [
    '',
    '## Projetos',
    ...profile.projects.flatMap((project) => [
      `- ${project.name}${project.url === null ? '' : ` (${project.url})`}`,
      `  Tecnologias: ${project.techs.join(', ')}`,
      `  ${project.description}`,
    ]),
  ];
}

function educationSection(profile: CandidateProfile): string[] {
  if (profile.education.length === 0) {
    return [];
  }

  return [
    '',
    '## Formacao',
    ...profile.education.map(
      (entry) => `- ${entry.degree} — ${entry.institution} (${describePeriod(entry)})`,
    ),
  ];
}

function describeJob(job: ResumeTargetJob): string {
  return [
    '# Vaga alvo',
    '',
    `Titulo: ${job.title}`,
    `Empresa: ${job.company}`,
    `Regime: ${describeWorkModel(job)}`,
    `Localidade: ${job.location.length > 0 ? job.location : 'nao informada'}`,
    `Tecnologias marcadas na captura: ${job.tags.length > 0 ? job.tags.join(', ') : 'nenhuma'}`,
    `Link: ${job.url}`,
    '',
    '## Descricao',
    truncate(job.description),
    '',
    'Escreva o curriculo deste candidato para esta vaga.',
  ].join('\n');
}

/** O `Record` fechado no tipo: regime novo no dominio quebra a compilacao aqui. */
const WORK_MODEL_LABELS: Record<JobWorkModel, string> = {
  REMOTE: 'remoto',
  HYBRID: 'hibrido',
  ONSITE: 'presencial',
  UNKNOWN: 'nao informado',
};

function describeWorkModel(job: ResumeTargetJob): string {
  return WORK_MODEL_LABELS[job.workModel];
}

function truncate(description: string): string {
  if (description.length <= MAX_JOB_DESCRIPTION_CHARS) {
    return description;
  }

  return `${description.slice(0, MAX_JOB_DESCRIPTION_CHARS)}\n[descricao truncada]`;
}
