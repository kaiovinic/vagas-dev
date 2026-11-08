import type {
  HarvestFile,
  HarvestSearchReport,
  HarvestStatus,
  RawPost,
} from '@/contract';
import type { PostsPage, SearchOpening } from '@/harvest/posts-page';
import {
  PAUSE_BETWEEN_SEARCHES_IN_MS,
  searchUrl,
  type PostsSearch,
} from '@/harvest/searches';
import { canonicalPostUrl, findActivityId } from '@/parser/linkedin-post-card';
import { parseSearchResults, type ParsedCard } from '@/parser/linkedin-posts-parser';

export interface HarvestRunnerDeps {
  readonly page: PostsPage;
  /** A ultima colheita. Preservada quando esta nao rende nada. */
  readonly previous: HarvestFile;
  readonly searches: readonly PostsSearch[];
  readonly maxScrolls: number;
  /** Teto de publicacoes por busca: barreira rigida, nao afinacao. */
  readonly postsPerSearch: number;
  readonly now: () => Date;
  readonly pause: (ms: number) => Promise<void>;
  readonly log: (message: string) => void;
}

interface SearchOutcome {
  readonly report: HarvestSearchReport;
  readonly posts: readonly RawPost[];
  readonly sessionLost: boolean;
  readonly failed: boolean;
}

/**
 * Uma colheita, do primeiro `goto` ao documento pronto para o disco.
 *
 * Nao escreve arquivo e nao conhece o Playwright: recebe a pagina como porta e
 * devolve o `HarvestFile`. E isso que torna a parte que DECIDE testavel por
 * inteiro, com uma pagina de mentira — e deixa para o adaptador apenas clicar e
 * ler atributo.
 *
 * Nunca lanca. Uma colheita que morre no meio e pior que uma colheita vazia: a
 * API ficaria lendo um arquivo que ninguem atualiza, sem nenhum sinal de que
 * algo quebrou.
 */
export async function runHarvest(deps: HarvestRunnerDeps): Promise<HarvestFile> {
  const reports: HarvestSearchReport[] = [];
  const posts = new Map<string, RawPost>();
  let failures = 0;

  for (const [index, search] of deps.searches.entries()) {
    if (index > 0) {
      await deps.pause(PAUSE_BETWEEN_SEARCHES_IN_MS);
    }

    const outcome = await collectSearch(deps, search);

    if (outcome.sessionLost) {
      return preserving(deps.previous, 'session-lost');
    }

    failures += outcome.failed ? 1 : 0;
    reports.push(outcome.report);

    // Chaveado pela URL: a mesma publicacao aparece nas duas buscas quando o
    // anuncio e remoto e cita a Bahia.
    for (const post of outcome.posts) {
      posts.set(post.url, post);
    }
  }

  return assemble(deps, reports, [...posts.values()], failures);
}

/**
 * Nenhuma busca abriu: a colheita anterior fica onde esta.
 *
 * Trocar tres dias de publicacoes por um arquivo vazio porque a rede piscou
 * seria o pior dos dois mundos — a API veria a fonte secar sem motivo. Com a
 * colheita preservada, a janela de 72h a faz expirar sozinha, e o relatorio das
 * buscas conta o que de fato aconteceu.
 */
function assemble(
  deps: HarvestRunnerDeps,
  reports: readonly HarvestSearchReport[],
  posts: readonly RawPost[],
  failures: number,
): HarvestFile {
  if (failures > 0 && failures === deps.searches.length) {
    deps.log('Nenhuma busca abriu: a colheita anterior fica no lugar');

    return { ...preserving(deps.previous, 'degraded'), searches: reports };
  }

  return {
    harvestedAt: deps.now().toISOString(),
    status: resolveStatus(failures),
    searches: reports,
    posts,
  };
}

function resolveStatus(failures: number): HarvestStatus {
  return failures === 0 ? 'ok' : 'degraded';
}

/**
 * `session-lost` guarda o `harvestedAt` ANTIGO, e nao o de agora.
 *
 * E o que mantem a idade da colheita honesta no painel: o material e velho, a
 * janela de 72h vai derruba-lo em tres dias, e carimbar a data de agora
 * esconderia exatamente isso.
 */
function preserving(previous: HarvestFile, status: HarvestStatus): HarvestFile {
  return {
    harvestedAt: previous.harvestedAt,
    status,
    searches: previous.searches,
    posts: previous.posts,
  };
}

async function collectSearch(
  deps: HarvestRunnerDeps,
  search: PostsSearch,
): Promise<SearchOutcome> {
  const opening = await deps.page.open(searchUrl(search.keywords));

  if (opening.outcome !== 'opened') {
    return notOpened(deps, search, opening);
  }

  await deps.page.revealMore(deps.maxScrolls);

  const { cards, discarded } = parseSearchResults(await deps.page.html());
  const { posts, withoutUrl } = await resolveUrls(deps, cards);

  deps.log(`Busca [${search.label}]: ${posts.length} publicacao(oes) aproveitada(s)`);

  return {
    report: {
      label: search.label,
      query: search.keywords,
      found: posts.length,
      discarded: { ...discarded, withoutUrl },
    },
    posts,
    sessionLost: false,
    failed: false,
  };
}

/** Busca que nao abriu entra no relatorio com zero, e nao desaparece dele. */
function notOpened(
  deps: HarvestRunnerDeps,
  search: PostsSearch,
  opening: Exclude<SearchOpening, { outcome: 'opened' }>,
): SearchOutcome {
  const sessionLost = opening.outcome === 'signed-out';

  deps.log(
    sessionLost
      ? `Sessao caida: o LinkedIn desviou para ${opening.url}`
      : `Busca [${search.label}] nao abriu: ${opening.reason}`,
  );

  return {
    report: { label: search.label, query: search.keywords, found: 0, discarded: NOTHING_SEEN },
    posts: [],
    sessionLost,
    failed: !sessionLost,
  };
}

const NOTHING_SEEN = {
  promoted: 0,
  openToWork: 0,
  unaddressable: 0,
  withoutContent: 0,
  withoutUrl: 0,
} as const;

async function resolveUrls(
  deps: HarvestRunnerDeps,
  cards: readonly ParsedCard[],
): Promise<{ readonly posts: readonly RawPost[]; readonly withoutUrl: number }> {
  const posts: RawPost[] = [];
  let withoutUrl = 0;

  for (const card of cards) {
    if (posts.length >= deps.postsPerSearch) {
      break;
    }

    const url = await resolveUrl(deps, card);

    if (url === undefined) {
      withoutUrl += 1;

      continue;
    }

    posts.push(toRawPost(card, url));
  }

  return { posts, withoutUrl };
}

/**
 * Do card ate o link permanente.
 *
 * O layout classico ja traz a urn no proprio card, e ai nao se pergunta nada ao
 * navegador. O novo nao traz, e so quem tem a pagina aberta chega da `cardKey`
 * ate a URL. Qualquer coisa que o navegador devolva passa pelo mesmo crivo: sem
 * id reconhecivel, nao serve — e nada e inventado a partir da `cardKey`.
 */
async function resolveUrl(
  deps: HarvestRunnerDeps,
  card: ParsedCard,
): Promise<string | undefined> {
  if (card.activityId !== undefined) {
    return canonicalPostUrl(card.activityId);
  }

  const resolved = await deps.page.postUrl(card.cardKey);
  const activityId = resolved === undefined ? undefined : findActivityId(resolved);

  return activityId === undefined ? undefined : canonicalPostUrl(activityId);
}

/**
 * O card vira publicacao. A forma canonica da URL, e nao a que veio da pagina,
 * porque e ela que a API decodifica — e porque duas rotas para o mesmo post
 * tem que render uma linha, nao duas.
 */
function toRawPost(card: ParsedCard, url: string): RawPost {
  return {
    url,
    author: card.author,
    ...(card.authorUrl === undefined ? {} : { authorUrl: card.authorUrl }),
    ...(card.headline === undefined ? {} : { headline: card.headline }),
    text: card.text,
    links: card.links,
    hasJobAction: card.hasJobAction,
  };
}
