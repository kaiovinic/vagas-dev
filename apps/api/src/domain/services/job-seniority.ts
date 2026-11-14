/**
 * Niveis do mais baixo para o mais alto. A ordem NAO e decorativa: e ela que
 * resolve o titulo que cita dois niveis ("Pleno/Senior") na distribuicao do
 * dashboard, onde cada vaga conta uma vez so, no nivel mais alto que casar.
 */
export const JOB_SENIORITY_LEVELS = ['INTERN', 'JUNIOR', 'MID', 'SENIOR', 'LEAD'] as const;

export type JobSeniorityLevel = (typeof JOB_SENIORITY_LEVELS)[number];

interface SeniorityVocabulary {
  readonly label: string;
  /**
   * Termos procurados **somente no titulo da vaga**.
   *
   * A descricao e as tags foram descartadas de proposito: "Vaga internacional"
   * (tag do Remotar) e "processo interno" na descricao faziam vagas senior serem
   * classificadas como estagio. Nos dados reais o titulo carrega o nivel em todas
   * as vagas que o informam, entao limitar ao titulo nao perde sinal.
   *
   * As variantes com e sem acento vao explicitas: a busca do Postgres ignora
   * maiusculas, mas nao ignora acento — "Senior" nao casa com "Sênior".
   *
   * Abreviacoes levam espaco a esquerda (` sr`, ` jr`) para nao casarem no meio de
   * outra palavra. Fica um limite conhecido: um titulo com " SRE" casaria como
   * senior — nao ha busca por limite de palavra no `contains` do Prisma.
   */
  readonly keywords: readonly string[];
}

const VOCABULARY: Readonly<Record<JobSeniorityLevel, SeniorityVocabulary>> = {
  INTERN: {
    label: 'Estagio',
    keywords: ['estagi', 'estági', 'internship', 'trainee'],
  },
  JUNIOR: {
    label: 'Junior',
    keywords: ['junior', 'júnior', ' jr'],
  },
  MID: {
    label: 'Pleno',
    keywords: ['pleno', 'plena', 'mid-level', 'mid level'],
  },
  SENIOR: {
    label: 'Senior',
    keywords: ['senior', 'sênior', ' sr'],
  },
  LEAD: {
    label: 'Lead/Especialista',
    keywords: ['lead', 'staff', 'principal', 'especialista', 'specialist'],
  },
};

export function seniorityLabel(level: JobSeniorityLevel): string {
  return VOCABULARY[level].label;
}

export function seniorityKeywords(level: JobSeniorityLevel): readonly string[] {
  return VOCABULARY[level].keywords;
}

export function isJobSeniorityLevel(value: string): value is JobSeniorityLevel {
  return JOB_SENIORITY_LEVELS.some((level) => level === value);
}

/** Expande os niveis escolhidos na lista unica de termos a procurar. */
export function expandSeniorities(levels: readonly string[]): string[] {
  const keywords = new Set<string>();

  for (const level of levels) {
    if (!isJobSeniorityLevel(level)) {
      continue;
    }

    for (const keyword of seniorityKeywords(level)) {
      keywords.add(keyword);
    }
  }

  return [...keywords];
}

/**
 * Termos dos niveis ACIMA do informado.
 *
 * Servem de exclusao na distribuicao por senioridade: sem eles, "Tech Lead
 * Senior" entraria nas duas barras e a soma passaria do total capturado.
 */
export function keywordsAboveSeniority(level: JobSeniorityLevel): string[] {
  const position = JOB_SENIORITY_LEVELS.indexOf(level);

  return JOB_SENIORITY_LEVELS.slice(position + 1).flatMap((higher) => [
    ...seniorityKeywords(higher),
  ]);
}
