import type { Job } from '@/domain/entities/job';
import {
  LOCATION_KEYWORDS,
  REMOTE_LOCATION_LABEL,
  SPAM_KEYWORDS,
  STACK_KEYWORDS,
} from '@/domain/services/job-rule-catalog';
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
} as const;

export type JobRejectionReason = (typeof JobRejectionReason)[keyof typeof JobRejectionReason];

export type PublicRuleKind =
  | 'TIME_WINDOW'
  | 'KEYWORD_ALLOW_LIST'
  | 'KEYWORD_DENY_LIST'
  | 'LOCATION_ALLOW_LIST';

export interface JobEvaluation {
  readonly approved: boolean;
  readonly rejectionReasons: readonly JobRejectionReason[];
  readonly matchedStack: readonly string[];
  readonly matchedLocations: readonly string[];
  readonly matchedSpamTerms: readonly string[];
}

export interface PublicJobRule {
  readonly id: 'publication-window' | 'stack-match' | 'location-match' | 'spam-filter';
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

  private readonly spamGroups: readonly CompiledKeywordGroup[] =
    compileKeywordGroups(SPAM_KEYWORDS);

  private readonly publicRules: PublicJobRules = buildPublicRules();

  evaluate(job: Job, reference: Date = new Date()): JobEvaluation {
    const text = normalizeForMatching(job.searchableText);
    const matchedStack = matchKeywordLabels(text, this.stackGroups);
    const matchedLocations = this.matchLocations(job, text);
    const matchedSpamTerms = matchKeywordLabels(text, this.spamGroups);
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

    return {
      approved: rejectionReasons.length === 0,
      rejectionReasons,
      matchedStack,
      matchedLocations,
      matchedSpamTerms,
    };
  }

  isApproved(job: Job, reference?: Date): boolean {
    return this.evaluate(job, reference).approved;
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

    for (const label of matchKeywordLabels(normalizedText, this.locationGroups)) {
      labels.add(label);
    }

    return [...labels];
  }
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
      name: 'Remoto ou Salvador e Regiao Metropolitana',
      description:
        'Aceitamos vagas 100% remotas ou presenciais/hibridas em Salvador e nos municipios da Regiao Metropolitana.',
      kind: 'LOCATION_ALLOW_LIST',
      criteria: LOCATION_KEYWORDS.map((group) => group.label),
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
