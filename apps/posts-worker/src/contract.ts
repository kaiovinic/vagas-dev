/**
 * Contrato entre o worker e a API (RFC 001, secao 5).
 *
 * Este arquivo e a fronteira do servico: e o que o `GET /posts` devolve e o que
 * o `LinkedinAuthPostsScraperProvider` do @devradar/api espera receber. Os dois
 * lados tem copias independentes destes tipos — nao ha codigo compartilhado
 * entre os workspaces de proposito, porque o worker nao deve nada ao Nest nem
 * ao Prisma. O preco e manter as duas copias de acordo, e o teste do provider,
 * do outro lado, usa um exemplo gerado a partir daqui.
 *
 * Por que o payload nao traz `publishedAt`: a data sai do snowflake embutido na
 * URL do post, e quem decodifica e a API, que ja tem `decodePostTimestamp`
 * testado. O worker entrega a URL e nao opina sobre data — em especial, nunca
 * le "ha 3 h" da tela.
 */

/**
 * Em que estado ficou a ultima colheita.
 *
 * - `ok`          todas as buscas rodaram.
 * - `degraded`    navegou logado, mas alguma busca falhou; `posts` tem o que deu.
 * - `session-lost` o LinkedIn desviou para login/checkpoint. `posts` preserva a
 *                 ultima colheita boa, e `harvestedAt` continua sendo a dela:
 *                 a janela de 72h da API faz esse material secar sozinho.
 * - `never-ran`   o worker subiu e ainda nao colheu nada.
 */
export const HARVEST_STATUSES = ['ok', 'degraded', 'session-lost', 'never-ran'] as const;

export type HarvestStatus = (typeof HARVEST_STATUSES)[number];

/**
 * Uma publicacao como o worker a enxerga: texto cru, sem juizo de valor.
 *
 * Nada aqui foi filtrado pelo motor de regras — isso e trabalho da API. O
 * worker so descarta o que nao da para usar: post sem URL reconhecivel e
 * anuncio patrocinado.
 */
export interface RawPost {
  /** Link permanente, sem query de rastreamento. Contem o id do post. */
  readonly url: string;
  /** Nome como aparece no card. Quem publica e a pessoa, nao a empresa. */
  readonly author: string;
  /** Perfil do autor, quando o card expoe o link. */
  readonly authorUrl?: string | undefined;
  /** Subtitulo do autor ("Tech Recruiter"), util para reconhecer recrutador. */
  readonly headline?: string | undefined;
  /** Texto da publicacao, ja expandido ("...mais" clicado). */
  readonly text: string;
  /**
   * Selo "buscando emprego" na foto do autor. A API usa para descartar quem
   * procura recolocacao, que e justamente o que o motor de regras precisa
   * barrar em post social.
   */
  readonly openToWork: boolean;
}

/** Quanto cada busca rendeu. Diagnostico: diz qual consulta secou. */
export interface HarvestSearchReport {
  readonly label: string;
  readonly query: string;
  readonly found: number;
}

/**
 * O arquivo `harvest.json`, que e tambem o corpo da resposta do `GET /posts`.
 *
 * Ser o mesmo documento nos dois lugares e intencional: o endpoint le e
 * devolve, sem transformar nada. Nao existe caminho em que a API receba algo
 * que nao esteja no disco, o que torna qualquer suspeita verificavel com um
 * `cat` no volume.
 */
export interface HarvestFile {
  /**
   * Quando a colheita aconteceu, em ISO 8601 UTC. `null` so com `never-ran`.
   *
   * E este campo que sobe para a tabela de saude da API: sem ele o painel
   * mostraria a idade da LEITURA do cache, que acontece a cada captura, e
   * diria "agora" para dado de sete horas atras.
   */
  readonly harvestedAt: string | null;
  readonly status: HarvestStatus;
  readonly searches: readonly HarvestSearchReport[];
  readonly posts: readonly RawPost[];
}

/**
 * O que o worker devolve antes da primeira colheita.
 *
 * Existe para que o `GET /posts` nunca responda 404 nem corpo vazio: a API
 * recebe um documento valido que diz, em termos do contrato, que ainda nao ha
 * nada — e trata isso como fonte sem vagas, nao como falha.
 */
export const EMPTY_HARVEST: HarvestFile = {
  harvestedAt: null,
  status: 'never-ran',
  searches: [],
  posts: [],
};
