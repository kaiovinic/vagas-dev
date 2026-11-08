/**
 * Com que frequencia cada fonte e visitada.
 *
 * Mora no dominio porque duas camadas precisam do mesmo numero: o coletor de
 * publicacoes, que se recusa a rodar antes da hora, e a tabela de saude, que
 * anuncia a proxima execucao. Se cada um guardasse o seu, a tabela mentiria no
 * dia em que o intervalo mudasse.
 */
export const DEFAULT_SOURCE_INTERVAL_IN_HOURS = 2;

/**
 * Publicacoes sociais sao espacadas: a busca custa cota de API e o feed nao
 * renova nesse ritmo.
 */
export const SOCIAL_POSTS_INTERVAL_IN_HOURS = 4;

/**
 * Publicacoes lidas com sessao autenticada.
 *
 * Mais espacado que a busca por cota: aqui o que se protege nao e credito, e a
 * conta. Oito horas e o intervalo que o coletor de referencia usa, com o
 * comentario de que intervalo longo protege a conta. O numero de verdade mora
 * no worker, que tem o cron; este aqui existe para a tabela de saude anunciar a
 * proxima colheita sem mentir.
 */
export const AUTH_SOCIAL_POSTS_INTERVAL_IN_HOURS = 8;

const INTERVALS: Readonly<Record<string, number>> = {
  'linkedin-posts': SOCIAL_POSTS_INTERVAL_IN_HOURS,
  'linkedin-auth-posts': AUTH_SOCIAL_POSTS_INTERVAL_IN_HOURS,
};

export function sourceIntervalInHours(source: string): number {
  return INTERVALS[source] ?? DEFAULT_SOURCE_INTERVAL_IN_HOURS;
}

const MILLISECONDS_IN_HOUR = 60 * 60 * 1000;

/** Quando a fonte deve ser visitada de novo; `null` se nunca rodou. */
export function nextSourceRunAt(source: string, lastRunAt: Date | null): Date | null {
  if (lastRunAt === null) {
    return null;
  }

  return new Date(lastRunAt.getTime() + sourceIntervalInHours(source) * MILLISECONDS_IN_HOUR);
}
