import {
  compileKeywordGroups,
  matchKeywordLabels,
  normalizeForMatching,
} from '@/domain/value-objects/text-normalizer';

export const JOB_SCOPES = ['NATIONAL', 'INTERNATIONAL', 'UNKNOWN'] as const;

export type JobScope = (typeof JOB_SCOPES)[number];

export interface ClassifiableJob {
  readonly title: string;
  /** Entra so na checagem de intermediaria estrangeira: e la que a marca aparece. */
  readonly company: string;
  readonly description: string;
  readonly location: string;
  readonly tags: readonly string[];
}

/**
 * Intermediarias estrangeiras e anuncio em espanhol. Vencem tudo, ate o regime
 * CLT citado no texto: sao empresas que recrutam no Brasil para fora, e e
 * justamente o caso que o recorte nacional quer deixar de lado.
 */
const FOREIGN_INTERMEDIARY = compileKeywordGroups([
  { label: 'Anuncio em espanhol', aliases: ['desarrollador', 'desarrolladora', 'ingeniero de software'] },
  { label: 'Intermediaria estrangeira', aliases: ['bairesdev', 'lemon.io', 'turing.com', 'toptal'] },
]);

/**
 * Contrato brasileiro so existe com empresa brasileira: vence qualquer outro
 * sinal, inclusive pagamento em dolar.
 */
const BRAZILIAN_CONTRACT = compileKeywordGroups([
  { label: 'CLT', aliases: ['clt', 'carteira assinada', 'regime celetista'] },
  { label: 'PJ', aliases: ['pj', 'pessoa juridica'] },
]);

/**
 * Cargo escrito em portugues. Sinal fraco isolado, mas decisivo no conjunto: a
 * inspecao das vagas sem mercado identificado mostrou 31 de 39 com cargo em
 * PT-BR, de empresas brasileiras conhecidas que simplesmente nao escrevem
 * "Brasil" em lugar nenhum do anuncio.
 *
 * Vale SO no titulo. Na descricao, "desenvolvedores do mundo todo" marcaria
 * como nacional justamente a vaga que nao e.
 */
const BRAZILIAN_ROLE = compileKeywordGroups([
  {
    label: 'Cargo em portugues',
    aliases: [
      'desenvolvedor',
      'desenvolvedora',
      'desenvolvedores',
      'pessoa desenvolvedora',
      'engenheiro',
      'engenheira',
      'analista',
      'estagiario',
      'estagiaria',
      'programador',
      'programadora',
    ],
  },
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
  { label: 'Brasil', aliases: ['brasil', 'brazil', '[br]'] },
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
  const title = normalizeForMatching(job.title);
  const location = normalizeForMatching([job.location, ...job.tags].join(' '));
  const withCompany = normalizeForMatching([job.title, job.company].join(' '));

  // Intermediaria gringa e anuncio em espanhol vencem tudo, inclusive o CLT
  // que elas as vezes citam no texto.
  if (matchKeywordLabels(withCompany, FOREIGN_INTERMEDIARY).length > 0) {
    return 'INTERNATIONAL';
  }

  if (matchKeywordLabels(text, BRAZILIAN_CONTRACT).length > 0) {
    return 'NATIONAL';
  }

  if (matchKeywordLabels(text, INTERNATIONAL).length > 0) {
    return 'INTERNATIONAL';
  }

  // Siglas de estado so valem na localidade; soltas no texto dariam falso
  // positivo. "Brasil", "Brazil" e "[BR]" valem tambem no titulo, onde varias
  // fontes colocam o pais ("... Full-Stack Engineer - Brazil").
  if (
    matchKeywordLabels(location, BRAZILIAN_LOCATION).length > 0 ||
    matchKeywordLabels(title, BRAZILIAN_LOCATION).length > 0
  ) {
    return 'NATIONAL';
  }

  // Ultimo sinal, o mais fraco: cargo em portugues no titulo.
  if (matchKeywordLabels(title, BRAZILIAN_ROLE).length > 0) {
    return 'NATIONAL';
  }

  return 'UNKNOWN';
}

export function isJobScope(value: string): value is JobScope {
  return JOB_SCOPES.some((scope) => scope === value);
}
