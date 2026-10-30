/**
 * Leitura da URL publica de uma publicacao do LinkedIn.
 *
 * O formato e `linkedin.com/posts/<autor>_<resumo>-share-<id>-<hash>`, e o
 * `<id>` e um snowflake: os bits altos guardam o instante de criacao. Isso
 * significa que a URL, sozinha, ja diz QUEM publicou e QUANDO — sem nenhuma
 * requisicao ao LinkedIn.
 *
 * Isso importa para a janela de 72h: um resultado de buscador nao traz a data
 * de publicacao, e sem o snowflake a unica saida seria carimbar o instante da
 * captura, errando por horas.
 */

/**
 * Os 22 bits baixos sao sequencia e identificacao de no; o resto e o tempo em
 * milissegundos desde a epoca Unix. E o mesmo esquema do snowflake do Twitter,
 * porem sem epoca customizada.
 */
const TIMESTAMP_SHIFT = 22n;

/** `<autor>_<resumo>-share-<id>-<hash>`, com o id em digitos. */
const POST_PATH = /\/posts\/([^/_]+)_[^/]*?-(?:share|activity|ugcPost)-(\d{15,25})/i;

/** Formato alternativo: `/feed/update/urn:li:activity:<id>`. */
const FEED_URN = /urn:li:(?:activity|share|ugcPost):(\d{15,25})/i;

export interface LinkedinPostRef {
  /** Slug do perfil que publicou, como aparece na URL. */
  readonly author: string;
  readonly postId: string;
  /** Link permanente, sem query de rastreamento. */
  readonly url: string;
  readonly publishedAt: Date;
}

/**
 * Converte o id do post no instante da publicacao.
 *
 * Conferido contra duas publicacoes reais: `7521262024920764416` devolve
 * 28/10/2026 14:30:05 e `7521249835149062144` devolve 13:41:38 (Brasilia), que
 * batem com a ordem em que apareceram no feed.
 */
export function decodePostTimestamp(postId: string): Date | undefined {
  if (!/^\d{15,25}$/.test(postId)) {
    return undefined;
  }

  const milliseconds = Number(BigInt(postId) >> TIMESTAMP_SHIFT);

  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return undefined;
  }

  const published = new Date(milliseconds);

  return Number.isNaN(published.getTime()) ? undefined : published;
}

/**
 * Extrai autor, id e data da URL do post. Devolve `undefined` quando a URL nao
 * e de uma publicacao — o resultado de buscador mistura perfis, artigos e
 * paginas de empresa com os posts.
 */
export function parsePostUrl(rawUrl: string): LinkedinPostRef | undefined {
  const normalized = stripQuery(rawUrl);
  const match = POST_PATH.exec(normalized);
  const author = match?.[1];
  const postId = match?.[2] ?? FEED_URN.exec(normalized)?.[1];

  if (!postId) {
    return undefined;
  }

  const publishedAt = decodePostTimestamp(postId);

  if (!publishedAt || !author) {
    return undefined;
  }

  return { author, postId, url: normalized, publishedAt };
}

/** O nome que aparece no card vem do slug: `maria-silva-123abc` -> `Maria Silva`. */
export function authorDisplayName(author: string): string {
  return author
    .split('-')
    // Sufixo aleatorio que o LinkedIn acrescenta ao slug quando ha homonimos.
    .filter((part) => part.length > 0 && !/^[0-9a-f]{6,}$/i.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function stripQuery(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);

    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  } catch {
    return rawUrl.trim();
  }
}
