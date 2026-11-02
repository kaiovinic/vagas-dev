import { InvalidCandidateProfileError } from '@/domain/errors/invalid-candidate-profile-error';

const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];
/** `YYYY-MM`: o mes basta num curriculo, e o dia so acrescentaria ruido. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ProfileExperience {
  readonly company: string;
  readonly role: string;
  readonly startedAt: string;
  /** Nulo significa "ainda estou aqui": e o que o curriculo precisa dizer. */
  readonly endedAt: string | null;
  readonly description: string;
  readonly techs: readonly string[];
}

export interface ProfileEducation {
  readonly institution: string;
  readonly degree: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface ProfileSkillGroup {
  readonly category: string;
  readonly items: readonly string[];
}

export interface ProfileProject {
  readonly name: string;
  readonly description: string;
  readonly url: string | null;
  readonly techs: readonly string[];
}

export interface CreateCandidateProfileProps {
  readonly fullName: string;
  readonly headline: string;
  readonly summary: string;
  readonly email: string;
  readonly city: string;
  readonly phone?: string | null;
  readonly linkedinUrl?: string | null;
  readonly githubUrl?: string | null;
  readonly portfolioUrl?: string | null;
  readonly experiences?: readonly ProfileExperience[];
  readonly education?: readonly ProfileEducation[];
  readonly skills?: readonly ProfileSkillGroup[];
  readonly projects?: readonly ProfileProject[];
}

/**
 * O perfil verdadeiro do candidato, a materia-prima do gerador de curriculo.
 *
 * As invariantes vivem aqui, e nao no schema HTTP, porque elas valem para toda
 * origem: o painel hoje, uma importacao de PDF amanha, uma seed de teste agora.
 * O que a entidade garante e o que o gerador pode assumir sem conferir de novo.
 */
export class CandidateProfile {
  private constructor(private readonly props: Required<CreateCandidateProfileProps>) {}

  static create(props: CreateCandidateProfileProps): CandidateProfile {
    return new CandidateProfile({
      fullName: requireText(props.fullName, 'fullName'),
      headline: requireText(props.headline, 'headline'),
      summary: requireText(props.summary, 'summary'),
      email: requireEmail(props.email),
      city: requireText(props.city, 'city'),
      phone: optionalText(props.phone),
      linkedinUrl: optionalHttpUrl(props.linkedinUrl, 'linkedinUrl'),
      githubUrl: optionalHttpUrl(props.githubUrl, 'githubUrl'),
      portfolioUrl: optionalHttpUrl(props.portfolioUrl, 'portfolioUrl'),
      experiences: (props.experiences ?? []).map(toExperience),
      education: (props.education ?? []).map(toEducation),
      skills: (props.skills ?? []).map(toSkillGroup),
      projects: (props.projects ?? []).map(toProject),
    });
  }

  get fullName(): string {
    return this.props.fullName;
  }

  get headline(): string {
    return this.props.headline;
  }

  get summary(): string {
    return this.props.summary;
  }

  get email(): string {
    return this.props.email;
  }

  get city(): string {
    return this.props.city;
  }

  get phone(): string | null {
    return this.props.phone;
  }

  get linkedinUrl(): string | null {
    return this.props.linkedinUrl;
  }

  get githubUrl(): string | null {
    return this.props.githubUrl;
  }

  get portfolioUrl(): string | null {
    return this.props.portfolioUrl;
  }

  get experiences(): readonly ProfileExperience[] {
    return this.props.experiences;
  }

  get education(): readonly ProfileEducation[] {
    return this.props.education;
  }

  get skills(): readonly ProfileSkillGroup[] {
    return this.props.skills;
  }

  get projects(): readonly ProfileProject[] {
    return this.props.projects;
  }

  /**
   * Um perfil so serve para gerar curriculo quando tem ao menos uma experiencia
   * e uma competencia: sem isso o modelo nao teria o que selecionar, e a unica
   * saida possivel seria inventar. A fase do gerador consulta isto antes de
   * gastar token.
   */
  get isUsableForResume(): boolean {
    return this.props.experiences.length > 0 && this.props.skills.length > 0;
  }

  toJSON(): Required<CreateCandidateProfileProps> {
    return { ...this.props };
  }
}

function toExperience(entry: ProfileExperience, index: number): ProfileExperience {
  const field = `experiences[${index}]`;

  return {
    company: requireText(entry.company, `${field}.company`),
    role: requireText(entry.role, `${field}.role`),
    description: requireText(entry.description, `${field}.description`),
    techs: requireTextList(entry.techs, `${field}.techs`),
    ...requirePeriod(entry.startedAt, entry.endedAt, field),
  };
}

function toEducation(entry: ProfileEducation, index: number): ProfileEducation {
  const field = `education[${index}]`;

  return {
    institution: requireText(entry.institution, `${field}.institution`),
    degree: requireText(entry.degree, `${field}.degree`),
    ...requirePeriod(entry.startedAt, entry.endedAt, field),
  };
}

function toSkillGroup(entry: ProfileSkillGroup, index: number): ProfileSkillGroup {
  const field = `skills[${index}]`;
  const items = requireTextList(entry.items, `${field}.items`);

  if (items.length === 0) {
    throw new InvalidCandidateProfileError(`${field}.items must have at least one item`);
  }

  return { category: requireText(entry.category, `${field}.category`), items };
}

function toProject(entry: ProfileProject, index: number): ProfileProject {
  const field = `projects[${index}]`;

  return {
    name: requireText(entry.name, `${field}.name`),
    description: requireText(entry.description, `${field}.description`),
    url: optionalHttpUrl(entry.url, `${field}.url`),
    techs: requireTextList(entry.techs, `${field}.techs`),
  };
}

/** Periodo em meses, com o fim opcional e nunca anterior ao inicio. */
function requirePeriod(
  startedAt: string,
  endedAt: string | null,
  field: string,
): { startedAt: string; endedAt: string | null } {
  const start = requireMonth(startedAt, `${field}.startedAt`);
  const end = endedAt === null || endedAt === undefined ? null : requireMonth(endedAt, `${field}.endedAt`);

  if (end !== null && end < start) {
    throw new InvalidCandidateProfileError(`${field}.endedAt must not be before startedAt`);
  }

  return { startedAt: start, endedAt: end };
}

function requireMonth(value: unknown, field: string): string {
  const trimmed = asTrimmedText(value);

  if (!MONTH_PATTERN.test(trimmed)) {
    throw new InvalidCandidateProfileError(`${field} must be a month in the YYYY-MM format`);
  }

  return trimmed;
}

/** E-mail e o unico contato obrigatorio: sem ele o curriculo nao tem retorno. */
function requireEmail(value: unknown): string {
  const trimmed = requireText(value, 'email');

  if (!EMAIL_PATTERN.test(trimmed)) {
    throw new InvalidCandidateProfileError('email must be a valid e-mail address');
  }

  return trimmed;
}

/**
 * `unknown` de proposito: estas guardas tambem recebem o que voltou da coluna
 * JSONB, onde o tipo do TypeScript nao garante nada. Tratar um numero ou um
 * nulo gravado por engano como texto ausente e melhor que confiar na assinatura.
 */
function requireText(value: unknown, field: string): string {
  const trimmed = asTrimmedText(value);

  if (trimmed.length === 0) {
    throw new InvalidCandidateProfileError(`${field} is required`);
  }

  return trimmed;
}

function requireTextList(values: readonly unknown[] | undefined, field: string): string[] {
  if (values === undefined) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new InvalidCandidateProfileError(`${field} must be a list`);
  }

  return values.map((value, index) => requireText(value, `${field}[${index}]`));
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = asTrimmedText(value);

  return trimmed.length > 0 ? trimmed : null;
}

/** Qualquer coisa que nao seja texto conta como ausente, nao como "[object Object]". */
function asTrimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalHttpUrl(value: string | null | undefined, field: string): string | null {
  const trimmed = optionalText(value);

  if (trimmed === null) {
    return null;
  }

  if (!ALLOWED_URL_PROTOCOLS.includes(parseUrl(trimmed, field).protocol)) {
    throw new InvalidCandidateProfileError(`${field} must use the http or https protocol`);
  }

  return trimmed;
}

function parseUrl(value: string, field: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new InvalidCandidateProfileError(`${field} must be a valid absolute URL`);
  }
}
