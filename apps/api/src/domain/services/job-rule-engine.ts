import type { Job } from '@/domain/entities/job';
import {
  HIRING_SIGNAL_KEYWORDS,
  JOB_AGGREGATOR_ACCOUNTS,
  BAHIA_STATE_KEYWORDS,
  LOCATION_FALSE_POSITIVES,
  LOCATION_KEYWORDS,
  REMOTE_LOCATION_LABEL,
  SPAM_KEYWORDS,
  STACK_KEYWORDS,
} from '@/domain/services/job-rule-catalog';
import {
  INTERNATIONAL_SCOPE_KEYWORDS,
  classifyJobScope,
  type JobScope,
} from '@/domain/services/job-scope';
import {
  compileKeywordGroups,
  matchKeywordLabels,
  normalizeForMatching,
  type CompiledKeywordGroup,
} from '@/domain/value-objects/text-normalizer';

export const PUBLICATION_WINDOW_IN_HOURS = 72;
export const PUBLIC_RULES_VERSION = '1.0.0';

export const JobRejectionReason = {
  ExpiredPublication: 'EXPIRED_PUBLICATION',
  StackNotMatched: 'STACK_NOT_MATCHED',
  LocationNotAllowed: 'LOCATION_NOT_ALLOWED',
  SpamDetected: 'SPAM_DETECTED',
  InternationalScope: 'INTERNATIONAL_SCOPE',
  HiringSignalMissing: 'HIRING_SIGNAL_MISSING',
  AggregatorAccount: 'AGGREGATOR_ACCOUNT',
} as const;

/**
 * De onde veio a publicacao. Um anuncio de portal ja e, por construcao, uma
 * vaga; uma publicacao de rede social e texto livre, e precisa provar que
 * anuncia uma vaga antes de entrar no radar.
 */
export const JOB_ORIGINS = ['PORTAL', 'SOCIAL_POST'] as const;

export type JobOrigin = (typeof JOB_ORIGINS)[number];

export interface EvaluationContext {
  /** Rotulos que a fonte publica junto da vaga; decidem o mercado. */
  readonly tags?: readonly string[] | undefined;
  readonly origin?: JobOrigin | undefined;
}

export type JobRejectionReason = (typeof JobRejectionReason)[keyof typeof JobRejectionReason];

export type PublicRuleKind =
  | 'TIME_WINDOW'
  | 'KEYWORD_ALLOW_LIST'
  | 'KEYWORD_DENY_LIST'
  | 'LOCATION_ALLOW_LIST'
  | 'SCOPE_DENY_LIST'
  | 'POST_REQUIREMENT';

export interface JobEvaluation {
  readonly approved: boolean;
  readonly rejectionReasons: readonly JobRejectionReason[];
  readonly matchedStack: readonly string[];
  readonly matchedLocations: readonly string[];
  readonly matchedSpamTerms: readonly string[];
  /** Marcadores de contratacao achados; so consultados em publicacao social. */
  readonly matchedHiringSignals: readonly string[];
  /**
   * Mercado classificado durante a avaliacao. Sai junto para que o chamador
   * grave a coluna `scope` sem classificar de novo — a regra e a coluna
   * passam a ler da mesma fonte.
   */
  readonly scope: JobScope;
}

export interface PublicJobRule {
  readonly id:
    | 'publication-window'
    | 'stack-match'
    | 'location-match'
    | 'spam-filter'
    | 'national-scope'
    | 'post-hiring-signal'
    | 'post-aggregator-account';
  readonly name: string;
  readonly description: string;
  readonly kind: PublicRuleKind;
  readonly criteria: readonly string[];
  readonly rejectionReason: JobRejectionReason;
}

export interface PublicJobRules {
  readonly version: string;
  readonly publicationWindowInHours: number;
  readonly rules: readonly PublicJobRule[];
}

/**
 * Motor de regras do dominio: decide se uma publicacao capturada e de fato uma vaga
 * elegivel (frescor, stack, localidade e ausencia de spam) e publica esses criterios.
 */
export class JobRuleEngine {
  private readonly stackGroups: readonly CompiledKeywordGroup[] =
    compileKeywordGroups(STACK_KEYWORDS);

  private readonly locationGroups: readonly CompiledKeywordGroup[] =
    compileKeywordGroups(LOCATION_KEYWORDS);

  private readonly stateGroups: readonly CompiledKeywordGroup[] =
    compileKeywordGroups(BAHIA_STATE_KEYWORDS);

  private readonly spamGroups: readonly CompiledKeywordGroup[] =
    compileKeywordGroups(SPAM_KEYWORDS);

  private readonly hiringSignalGroups: readonly CompiledKeywordGroup[] =
    compileKeywordGroups(HIRING_SIGNAL_KEYWORDS);

  private readonly aggregatorGroups: readonly CompiledKeywordGroup[] =
    compileKeywordGroups(JOB_AGGREGATOR_ACCOUNTS);

  private readonly publicRules: PublicJobRules = buildPublicRules();

  /**
   * `tags` sao os rotulos que a fonte publica junto da vaga (a Remotar marca
   * "Vaga internacional" assim). A entidade `Job` nao os carrega — sao metadado
   * da captura —, mas eles decidem o mercado, por isso entram aqui.
   */
  evaluate(
    job: Job,
    reference: Date = new Date(),
    context: EvaluationContext = {},
  ): JobEvaluation {
    const tags = context.tags ?? [];
    const origin = context.origin ?? 'PORTAL';
    const text = normalizeForMatching(job.searchableText);
    const matchedStack = matchKeywordLabels(text, this.stackGroups);
    const matchedLocations = this.matchLocations(job, text);
    const matchedSpamTerms = matchKeywordLabels(text, this.spamGroups);
    const matchedHiringSignals = [
      ...matchKeywordLabels(text, this.hiringSignalGroups),
      ...headlineSignal(job.title),
    ];
    const scope = classifyJobScope({
      title: job.title,
      company: job.company,
      description: job.description,
      location: job.location,
      tags,
    });
    const rejectionReasons: JobRejectionReason[] = [];

    if (!this.isWithinPublicationWindow(job, reference)) {
      rejectionReasons.push(JobRejectionReason.ExpiredPublication);
    }

    if (matchedStack.length === 0) {
      rejectionReasons.push(JobRejectionReason.StackNotMatched);
    }

    if (matchedLocations.length === 0) {
      rejectionReasons.push(JobRejectionReason.LocationNotAllowed);
    }

    if (matchedSpamTerms.length > 0) {
      rejectionReasons.push(JobRejectionReason.SpamDetected);
    }

    // So o internacional confirmado sai. `UNKNOWN` fica, porque a maioria das
    // vagas nao declara mercado e descartar por duvida esvaziaria o radar.
    if (scope === 'INTERNATIONAL') {
      rejectionReasons.push(JobRejectionReason.InternationalScope);
    }

    // So publicacao de rede social precisa provar que anuncia uma vaga.
    if (origin === 'SOCIAL_POST' && matchedHiringSignals.length === 0) {
      rejectionReasons.push(JobRejectionReason.HiringSignalMissing);
    }

    // O nome de quem publicou, e nao o texto: o anuncio de uma conta
    // agregadora e indistinguivel de um anuncio de verdade.
    if (origin === 'SOCIAL_POST' && this.isAggregator(job.company)) {
      rejectionReasons.push(JobRejectionReason.AggregatorAccount);
    }

    return {
      approved: rejectionReasons.length === 0,
      rejectionReasons,
      matchedStack,
      matchedLocations,
      matchedSpamTerms,
      matchedHiringSignals,
      scope,
    };
  }

  private isAggregator(company: string): boolean {
    return matchKeywordLabels(normalizeForMatching(company), this.aggregatorGroups).length > 0;
  }

  isApproved(job: Job, reference?: Date, context?: EvaluationContext): boolean {
    return this.evaluate(job, reference, context).approved;
  }

  filter(jobs: readonly Job[], reference?: Date): Job[] {
    return jobs.filter((job) => this.isApproved(job, reference));
  }

  /** Criterios estruturados para a aba publica de "Regras" do dashboard. */
  getPublicRules(): PublicJobRules {
    return this.publicRules;
  }

  private isWithinPublicationWindow(job: Job, reference: Date): boolean {
    const ageInHours = job.ageInHours(reference);

    return ageInHours >= 0 && ageInHours <= PUBLICATION_WINDOW_IN_HOURS;
  }

  private matchLocations(job: Job, normalizedText: string): string[] {
    const labels = new Set<string>();

    if (job.workModel === 'REMOTE') {
      labels.add(REMOTE_LOCATION_LABEL);
    }

    for (const label of matchKeywordLabels(withoutFalsePositives(normalizedText), this.locationGroups)) {
      labels.add(label);
    }

    // A UF vale so no campo de localidade. No texto inteiro, "BA" casaria com
    // Business Analyst e "Bahia" com empresa de outro estado que atende o
    // mercado baiano — as duas coisas aparecem em anuncio de verdade.
    const normalizedLocation = withoutFalsePositives(normalizeForMatching(job.location));

    for (const label of matchKeywordLabels(normalizedLocation, this.stateGroups)) {
      labels.add(label);
    }

    return [...labels];
  }
}

/** Apaga os trechos que contem o nome de uma cidade aceita mas apontam para outro lugar. */
/**
 * Publicacao que ABRE com "vaga" e anuncio, qualquer que seja o que vem
 * depois: "VAGA:", "VAGA | ...", "VAGA HOME OFFICE:", "VAGA REMOTA:".
 *
 * A posicao e o que decide, e nao uma lista de variantes — enumerar
 * delimitador por delimitador seria caca sem fim. "Vaga" no meio da frase
 * ("como se preparar para uma vaga de React") nao abre nada e continua fora.
 *
 * Os oito caracteres de folga no inicio absorvem emoji e pontuacao, que quase
 * todo recrutador usa antes da palavra.
 */
/*
 * O ponto e a reticencia ficam FORA do prefixo aceito de proposito: quando o
 * snippet comeca com "...", o buscador cortou o texto e o que se ve e meio de
 * frase, nao cabecalho. Era o que fazia "... vaga de Python Pleno. Mas dessa
 * vez nao foi abordagem" passar como anuncio.
 */
const POST_HEADLINE = /^[^a-z0-9.…]{0,8}vagas?\b/;

function headlineSignal(title: string): string[] {
  return POST_HEADLINE.test(normalizeForMatching(title)) ? ['Cabecalho de vaga'] : [];
}

function withoutFalsePositives(text: string): string {
  return LOCATION_FALSE_POSITIVES.reduce(
    (cleaned, phrase) => cleaned.split(phrase).join(' '),
    text,
  );
}

function buildPublicRules(): PublicJobRules {
  const rules: PublicJobRule[] = [
    {
      id: 'publication-window',
      name: 'Janela de publicacao de 72 horas',
      description:
        'Somente vagas publicadas nas ultimas 72 horas (horario de Brasilia) entram no radar. Publicacoes com data no futuro sao descartadas.',
      kind: 'TIME_WINDOW',
      criteria: [
        `Publicada nos ultimos ${PUBLICATION_WINDOW_IN_HOURS}h`,
        'Data de publicacao nao pode estar no futuro',
      ],
      rejectionReason: JobRejectionReason.ExpiredPublication,
    },
    {
      id: 'stack-match',
      name: 'Stack Frontend ou Fullstack',
      description:
        'A vaga precisa citar ao menos uma tecnologia ou papel da stack monitorada no titulo, na descricao, na empresa ou na localidade.',
      kind: 'KEYWORD_ALLOW_LIST',
      criteria: STACK_KEYWORDS.map((group) => group.label),
      rejectionReason: JobRejectionReason.StackNotMatched,
    },
    {
      id: 'location-match',
      name: 'Remoto ou qualquer municipio da Bahia',
      description:
        'Aceitamos vagas 100% remotas, de qualquer lugar, ou presenciais/hibridas em qualquer municipio da Bahia. A UF ("BA", "Bahia") e reconhecida no campo de localidade da vaga; os municipios abaixo valem tambem quando citados no texto do anuncio.',
      kind: 'LOCATION_ALLOW_LIST',
      criteria: [...LOCATION_KEYWORDS, ...BAHIA_STATE_KEYWORDS].map((group) => group.label),
      rejectionReason: JobRejectionReason.LocationNotAllowed,
    },
    {
      id: 'spam-filter',
      name: 'Higienizacao de publicacoes que nao sao vagas',
      description:
        'Descartamos publicacoes que citam as tecnologias mas nao oferecem vaga: cursos, bootcamps, mentorias, listas de grupos, divulgacao de curriculo e candidatos em recolocacao.',
      kind: 'KEYWORD_DENY_LIST',
      criteria: SPAM_KEYWORDS.map((group) => group.label),
      rejectionReason: JobRejectionReason.SpamDetected,
    },
    {
      id: 'national-scope',
      name: 'Somente mercado nacional',
      description:
        'O radar cobre apenas o mercado brasileiro. Vagas que se declaram internacionais, abertas para qualquer pais ou com pagamento em moeda estrangeira sao descartadas. Vaga em regime CLT e sempre nacional, mesmo citando pagamento em dolar.',
      kind: 'SCOPE_DENY_LIST',
      criteria: INTERNATIONAL_SCOPE_KEYWORDS.map((group) => group.label),
      rejectionReason: JobRejectionReason.InternationalScope,
    },
    {
      id: 'post-hiring-signal',
      name: 'Publicacao precisa anunciar uma vaga',
      description:
        'Vale apenas para publicacoes de rede social. O texto precisa conter um marcador de contratacao; sem ele, o que sobra e opiniao sobre o mercado, relato de carreira ou divulgacao de conteudo, que citam as mesmas tecnologias. Anuncio de portal nao passa por esta regra.',
      kind: 'POST_REQUIREMENT',
      criteria: HIRING_SIGNAL_KEYWORDS.map((group) => group.label),
      rejectionReason: JobRejectionReason.HiringSignalMissing,
    },
    {
      id: 'post-aggregator-account',
      name: 'Publicacao de conta agregadora',
      description:
        'Vale apenas para publicacoes de rede social. Contas que republicam vaga de terceiros em massa sao descartadas pelo NOME de quem publicou, nao pelo texto: o anuncio delas e indistinguivel de um anuncio legitimo, mas elas nao sao quem contrata e as vagas chegam ja republicadas de outro lugar.',
      kind: 'POST_REQUIREMENT',
      criteria: JOB_AGGREGATOR_ACCOUNTS.flatMap((group) => group.aliases),
      rejectionReason: JobRejectionReason.AggregatorAccount,
    },
  ];

  for (const rule of rules) {
    Object.freeze(rule.criteria);
    Object.freeze(rule);
  }

  return Object.freeze({
    version: PUBLIC_RULES_VERSION,
    publicationWindowInHours: PUBLICATION_WINDOW_IN_HOURS,
    rules: Object.freeze(rules),
  });
}
