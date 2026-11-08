/**
 * Leitura de pedaco de card de publicacao: texto, rotulo, id.
 *
 * Tudo aqui e funcao pura sobre string, sem cheerio e sem navegador. Mora
 * separado do parser porque e a parte que da para testar sem HTML nenhum, e
 * porque e onde ficam as esquisitices do LinkedIn que valem explicacao.
 */

/** URL base, tambem usada para resolver href relativo. */
export const LINKEDIN_BASE_URL = 'https://www.linkedin.com';

/**
 * O id do post aparece como `urn:li:activity:<digitos>`, e tambem como `share`
 * ou `ugcPost` em publicacao mais antiga. Os tres apontam para o mesmo
 * documento, e `/feed/update/urn:li:activity:<id>` abre qualquer um deles.
 */
const ACTIVITY_URN = /urn:li:(?:activity|share|ugcPost):(\d{10,25})/i;

export function findActivityId(cardHtml: string): string | undefined {
  return ACTIVITY_URN.exec(cardHtml)?.[1];
}

/** Link permanente a partir do id. E desta URL que a API tira a data. */
export function canonicalPostUrl(activityId: string): string {
  return `${LINKEDIN_BASE_URL}/feed/update/urn:li:activity:${activityId}/`;
}

export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Texto que o LinkedIn repete para leitor de tela vem duplicado no DOM:
 * "PromovidoPromovido" em vez de "Promovido". Sem desfazer isso, nenhum rotulo
 * casa com comparacao exata.
 *
 * So desfaz quando as duas metades sao identicas — "Vaga Vaga" de um texto de
 * verdade nao e tocado, porque tem o espaco no meio.
 */
export function undup(value: string): string {
  const text = collapseSpaces(value);
  const half = text.length / 2;

  if (!Number.isInteger(half) || text.slice(0, half) !== text.slice(half)) {
    return text;
  }

  return text.slice(0, half);
}

/** Rotulo de anuncio pago, nas duas linguas e nos dois generos. */
const PROMOTED_LABEL = /^(?:Promovid[oa]|Patrocinad[oa]|Promoted|Sponsored)$/i;

/**
 * Compara o rotulo inteiro, nao por `includes`: um post que FALA de anuncio
 * patrocinado nao e um anuncio patrocinado.
 */
export function isPromotedLabel(value: string): boolean {
  return PROMOTED_LABEL.test(undup(value));
}

/** Selo na foto do autor de quem esta procurando vaga. */
const SEEKING_BADGE = /buscando emprego|open to work|looking for a job/i;

/**
 * O selo chega como texto alternativo da foto, junto do nome: "Foto de Maria
 * Silva, buscando emprego". Exigir o nome evita confundir com o selo de outra
 * pessoa que apareca no mesmo card (um comentario, uma reacao).
 */
export function isSeekingBadge(imageAlt: string, author: string): boolean {
  return imageAlt.includes(author) && SEEKING_BADGE.test(imageAlt);
}

/**
 * Normaliza href para comparacao e armazenamento: absoluto, sem query e sem
 * barra final. Devolve vazio para o que nao e link navegavel (`javascript:`,
 * `mailto:`, URL malformada).
 */
export function normalizeHref(href: string): string {
  try {
    const parsed = new URL(href, LINKEDIN_BASE_URL);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }

    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/**
 * Caminhos do proprio LinkedIn que sao navegacao, nao conteudo do post.
 *
 * `/jobs/` NAO esta aqui de proposito: vaga do LinkedIn e justamente o link
 * que interessa.
 */
const NAVIGATION_PATHS = [
  '/in/',
  '/company/',
  '/feed/',
  '/search/',
  '/posts/',
  '/mynetwork',
  '/notifications',
  '/school/',
];

/** True quando o link e conteudo do post, e nao a mobilia do LinkedIn em volta. */
export function isEmbeddedLink(url: string): boolean {
  if (url.length === 0) {
    return false;
  }

  const { hostname, pathname } = new URL(url);

  // Encurtador do LinkedIn (`lnkd.in`) e qualquer dominio externo passam: e
  // para fora que aponta o anuncio de verdade.
  if (!hostname.endsWith('linkedin.com')) {
    return true;
  }

  if (pathname.startsWith('/jobs/')) {
    return true;
  }

  return pathname.length > 1 && !NAVIGATION_PATHS.some((path) => pathname.startsWith(path));
}

/** Botao ou link de candidatura. Vale como indicio de anuncio real. */
// `inscr` cobre "inscreva-se" e "inscricoes" de uma vez: o radical e o mesmo e
// a flexao do verbo nao e.
const JOB_ACTION_LABEL = /candidat|aplicar|apply|inscr|ver vaga|\bvagas?\b/i;

export function isJobActionLabel(label: string): boolean {
  return JOB_ACTION_LABEL.test(label);
}
