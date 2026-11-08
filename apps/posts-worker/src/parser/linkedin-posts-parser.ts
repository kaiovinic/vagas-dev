/**
 * Parser dos resultados da busca de publicacoes, sobre HTML estatico.
 *
 * Recebe `string` e devolve cards — nao recebe `Page`, nao chama `evaluate`,
 * nao abre navegador. E isso que torna a Fase 2 testavel com HTML salvo, e e a
 * diferenca deliberada em relacao ao coletor de referencia, que injeta um bloco
 * grande de JavaScript na pagina e so da para conferir contra o LinkedIn de
 * verdade.
 *
 * O preco: sem `innerText` nao existe "texto visivel". O referencial divide o
 * card em linhas e adivinha pela ordem delas; aqui tudo sai de atributo e de
 * container nomeado, que e mais chato de descobrir e muito mais estavel.
 *
 * ## Por que o card nao traz a URL
 *
 * No layout novo do LinkedIn (classes ofuscadas, card marcado por
 * `componentkey`) o id da publicacao NAO esta no DOM. O coletor de referencia
 * resolve isso abrindo o menu de cada post e lendo a area de transferencia — e
 * por isso que `parseNew` dele devolve `urn: null`.
 *
 * Logo este parser nao tem como produzir `RawPost`, que exige `url`. Ele
 * devolve `ParsedCard`, com `cardKey` para o card ser reencontrado na pagina, e
 * `activityId` apenas quando o HTML o traz (layout classico). Atribuir a URL e
 * trabalho do passo que dirige o navegador, e um card que nao receba URL e
 * descartado: sem link nao ha data, e data aproximada em janela de 72h e pior
 * que uma vaga a menos.
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

import type { HarvestDiscards } from '@/contract';
import {
  collapseSpaces,
  findActivityId,
  isEmbeddedLink,
  isJobActionLabel,
  isPromotedLabel,
  isSeekingBadge,
  normalizeHref,
} from '@/parser/linkedin-post-card';

/**
 * Contêineres de card, nas duas geracoes de layout. Um fornecedor novo de
 * marcacao entra como mais uma entrada nesta lista.
 */
const CARD_SELECTORS = [
  '[componentkey^="update-card-focus"]',
  '[data-urn^="urn:li:activity"]',
  '[data-id^="urn:li:activity"]',
].join(', ');

/**
 * Atributos do card que podem carregar a urn, em ordem de preferencia.
 *
 * Lidos SO do proprio card, nunca do HTML interno: post compartilhado embute
 * outro card, com a urn do post original. Procurando no HTML interno, o card de
 * fora herdaria o id do post compartilhado — e com ele a data de publicacao
 * errada, que e justamente o dado que a janela de 72h usa para decidir.
 */
const URN_ATTRIBUTES = ['data-urn', 'data-id', 'componentkey'];

/** `aria-label` do botao de menu do post: a fonte mais estavel do nome do autor. */
const AUTHOR_MENU_LABEL =
  /^(?:Abrir menu de controle da publicação de|Open control menu for post by)\s+(.+)$/i;

const AUTHOR_SELECTORS = [
  '.update-components-actor__title span[aria-hidden="true"]',
  '.update-components-actor__title',
];

const HEADLINE_SELECTORS = [
  '.update-components-actor__description span[aria-hidden="true"]',
  '.update-components-actor__description',
];

const TEXT_SELECTORS = [
  '[data-testid="expandable-text-box"]',
  '.feed-shared-update-v2__description .update-components-text',
  '.update-components-text',
  '.feed-shared-inline-show-more-text',
];

const AUTHOR_LINK_SELECTORS = 'a[href*="/in/"], a[href*="/company/"]';

/** Teto de links por post. Acima disso e lista de links, nao anuncio. */
const MAX_LINKS = 10;

/**
 * Um card reconhecido, antes de ter URL.
 *
 * `cardKey` e o valor do atributo que identifica o card — `componentkey` no
 * layout novo, a urn em `data-urn`/`data-id` no classico. E com ele, e so com
 * ele, que o passo do navegador reencontra o card na pagina para pedir o link.
 */
export interface ParsedCard {
  readonly cardKey: string;
  /** Preenchido so quando o HTML traz a urn (layout classico). */
  readonly activityId?: string | undefined;
  readonly author: string;
  readonly authorUrl?: string | undefined;
  readonly headline?: string | undefined;
  readonly text: string;
  readonly links: readonly string[];
  readonly hasJobAction: boolean;
}

/** Motivos de descarte que o parser conhece. Os demais nascem fora dele. */
export type ParserDiscardReason = Extract<
  keyof HarvestDiscards,
  'promoted' | 'openToWork' | 'unaddressable' | 'withoutContent'
>;

export type ParserDiscards = Readonly<Record<ParserDiscardReason, number>>;

export interface ParseResult {
  readonly cards: readonly ParsedCard[];
  readonly discarded: ParserDiscards;
}

const NO_DISCARDS: ParserDiscards = {
  promoted: 0,
  openToWork: 0,
  unaddressable: 0,
  withoutContent: 0,
};

/** Le a pagina de resultados inteira. Pagina sem card devolve resultado vazio. */
export function parseSearchResults(html: string): ParseResult {
  const $ = cheerio.load(html);
  const cards: ParsedCard[] = [];
  const discarded = { ...NO_DISCARDS };

  for (const element of outermostCards($)) {
    const card = readCard($, element);

    if (typeof card === 'string') {
      discarded[card] += 1;
      continue;
    }

    cards.push(card);
  }

  return { cards, discarded };
}

/**
 * So os contêineres mais externos.
 *
 * Post compartilhado traz outro card dentro de si; sem este filtro, o de
 * dentro viraria uma publicacao propria, com o autor errado.
 */
function outermostCards($: CheerioAPI): AnyNode[] {
  return $(CARD_SELECTORS)
    .toArray()
    .filter((element) => $(element).parents(CARD_SELECTORS).length === 0);
}

/** Como o card e identificado e, quando da, de onde sai a data. */
interface CardAddress {
  readonly cardKey: string;
  readonly activityId: string | undefined;
}

function readCard($: CheerioAPI, element: AnyNode): ParsedCard | ParserDiscardReason {
  if (hasPromotedLabel($, element)) {
    return 'promoted';
  }

  const address = readAddress($, element);

  if (address === undefined) {
    return 'unaddressable';
  }

  const author = readAuthor($, element);
  const text = readFirstText($, element, TEXT_SELECTORS);

  if (author.length === 0 || text.length === 0) {
    return 'withoutContent';
  }

  if (hasSeekingBadge($, element, author)) {
    return 'openToWork';
  }

  return buildCard($, element, address, author, text);
}

/**
 * `undefined` quando nao ha como enderecar o card depois: sem `componentkey` e
 * sem urn legivel, o passo do navegador nao teria como reencontra-lo, e o post
 * ficaria para sempre sem link.
 */
function readAddress($: CheerioAPI, element: AnyNode): CardAddress | undefined {
  const urnAttribute = URN_ATTRIBUTES.map((name) => attr($, element, name)).find(
    (value) => findActivityId(value) !== undefined,
  );
  const cardKey = $(element).attr('componentkey') ?? urnAttribute;

  if (cardKey === undefined) {
    return undefined;
  }

  return { cardKey, activityId: findActivityId(urnAttribute ?? '') };
}

function buildCard(
  $: CheerioAPI,
  element: AnyNode,
  address: CardAddress,
  author: string,
  text: string,
): ParsedCard {
  return {
    cardKey: address.cardKey,
    activityId: address.activityId,
    author,
    authorUrl: readAuthorUrl($, element, author),
    headline: readFirstText($, element, HEADLINE_SELECTORS) || undefined,
    text,
    links: readLinks($, element),
    hasJobAction: hasJobAction($, element),
  };
}

function hasPromotedLabel($: CheerioAPI, element: AnyNode): boolean {
  return $(element)
    .find('span, p')
    .toArray()
    .some((node) => isPromotedLabel($(node).text()));
}

/**
 * O selo "buscando emprego" vem no `alt` da foto do autor.
 *
 * Exige o nome do autor no proprio `alt` porque o card mostra outras fotos —
 * de quem reagiu, de quem comentou — e o selo de um terceiro nao diz nada
 * sobre quem publicou.
 */
function hasSeekingBadge($: CheerioAPI, element: AnyNode, author: string): boolean {
  return $(element)
    .find('img[alt]')
    .toArray()
    .some((image) => isSeekingBadge(attr($, image, 'alt'), author));
}

/** O `aria-label` do menu primeiro; o layout classico, depois. */
function readAuthor($: CheerioAPI, element: AnyNode): string {
  const fromMenu = readAuthorFromMenu($, element);

  return fromMenu.length > 0 ? fromMenu : readFirstText($, element, AUTHOR_SELECTORS);
}

function readAuthorFromMenu($: CheerioAPI, element: AnyNode): string {
  for (const node of $(element).find('[aria-label]').toArray()) {
    const name = AUTHOR_MENU_LABEL.exec(attr($, node, 'aria-label'))?.[1];

    if (name !== undefined) {
      return collapseSpaces(name);
    }
  }

  return '';
}

function readFirstText($: CheerioAPI, element: AnyNode, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const text = collapseSpaces($(element).find(selector).first().text());

    if (text.length > 0) {
      return text;
    }
  }

  return '';
}

/**
 * Perfil do autor. Prefere o link que carrega o nome dele: o card tem outros
 * links de perfil (quem reagiu, quem comentou).
 */
function readAuthorUrl($: CheerioAPI, element: AnyNode, author: string): string | undefined {
  const anchors = $(element).find(AUTHOR_LINK_SELECTORS).toArray();
  const chosen = anchors.find((anchor) => nodeLabel($, anchor).includes(author)) ?? anchors[0];

  if (chosen === undefined) {
    return undefined;
  }

  return normalizeHref(attr($, chosen, 'href')) || undefined;
}

function readLinks($: CheerioAPI, element: AnyNode): readonly string[] {
  const urls = $(element)
    .find('a[href]')
    .toArray()
    .map((anchor) => normalizeHref(attr($, anchor, 'href')))
    .filter(isEmbeddedLink);

  return [...new Set(urls)].slice(0, MAX_LINKS);
}

function hasJobAction($: CheerioAPI, element: AnyNode): boolean {
  return $(element)
    .find('a, button')
    .toArray()
    .some((node) => isJobActionLabel(nodeLabel($, node)));
}

/**
 * Atributo como string, com ausencia virando vazio.
 *
 * Existe para que esse `??` more em UM lugar. Espalhado pelas chamadas, ele
 * virava meia duzia de ramos que nenhum teste alcanca — o seletor que achou o
 * no ja garante o atributo — e cobertura cheia de ramo morto nao diz nada.
 */
function attr($: CheerioAPI, node: AnyNode, name: string): string {
  return $(node).attr(name) ?? '';
}

/** Rotulo de um no: o `aria-label` mais o texto, que e o que a pessoa le. */
function nodeLabel($: CheerioAPI, node: AnyNode): string {
  return collapseSpaces(`${attr($, node, 'aria-label')} ${$(node).text()}`);
}
