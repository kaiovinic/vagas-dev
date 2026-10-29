import {
  compileKeywordGroups,
  matchKeywordLabels,
  normalizeForMatching,
} from '@/domain/value-objects/text-normalizer';

export const JOB_SCOPES = ['NATIONAL', 'INTERNATIONAL', 'UNKNOWN'] as const;

export type JobScope = (typeof JOB_SCOPES)[number];

export interface ClassifiableJob {
  readonly title: string;
  readonly description: string;
  readonly location: string;
  readonly tags: readonly string[];
}

/**
 * Contrato brasileiro so existe com empresa brasileira: vence qualquer outro
 * sinal, inclusive pagamento em dolar.
 */
const BRAZILIAN_CONTRACT = compileKeywordGroups([
  { label: 'CLT', aliases: ['clt', 'carteira assinada', 'regime celetista'] },
]);

/**
 * Marcadores que caracterizam vaga internacional. Ficam exportados porque a aba
 * publica de `Regras` precisa mostra-los: o motor rejeita por esses termos.
 */
export const INTERNATIONAL_SCOPE_KEYWORDS = [
  {
    label: 'Internacional',
    aliases: [
      'vaga internacional',
      'internacional',
      'international',
      'latam',
      'latin america',
      'worldwide',
      'anywhere in the world',
      'globally',
    ],
  },
  {
    label: 'Pagamento em moeda estrangeira',
    aliases: ['em dolar', 'pagamento em dolar', 'usd', 'eur', 'paid in dollars'],
  },
] as const;

const INTERNATIONAL = compileKeywordGroups(INTERNATIONAL_SCOPE_KEYWORDS);

/** Estados e termos que amarram a vaga ao mercado brasileiro. */
const BRAZILIAN_LOCATION = compileKeywordGroups([
  { label: 'Brasil', aliases: ['brasil', 'brazil'] },
  {
    label: 'Estado brasileiro',
    aliases: [
      'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg',
      'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to',
    ],
  },
]);

/**
 * Classifica a vaga entre mercado nacional e internacional.
 *
 * A ordem importa: CLT vence tudo (so empresa brasileira contrata assim), depois
 * os sinais de internacional, e so entao a localidade brasileira — senao "Remoto,
 * Brasil, pagamento em dolar" cairia como nacional.
 *
 * Os termos sao casados com limite de palavra (`text-normalizer`), entao
 * "internacional" nunca casa dentro de outra palavra.
 */
export function classifyJobScope(job: ClassifiableJob): JobScope {
  const text = normalizeForMatching(
    [job.title, job.description, job.location, ...job.tags].join(' '),
  );
  const location = normalizeForMatching([job.location, ...job.tags].join(' '));

  if (matchKeywordLabels(text, BRAZILIAN_CONTRACT).length > 0) {
    return 'NATIONAL';
  }

  if (matchKeywordLabels(text, INTERNATIONAL).length > 0) {
    return 'INTERNATIONAL';
  }

  // Siglas de estado so valem na localidade; soltas no texto dariam falso positivo.
  if (matchKeywordLabels(location, BRAZILIAN_LOCATION).length > 0) {
    return 'NATIONAL';
  }

  return 'UNKNOWN';
}

export function isJobScope(value: string): value is JobScope {
  return JOB_SCOPES.some((scope) => scope === value);
}
