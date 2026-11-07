/**
 * A pagina de resultados, como o runner a enxerga.
 *
 * Existe para que o orquestrador da colheita nao conheca o Playwright: ele
 * recebe esta porta e um parser, e e testado inteiro com uma pagina de
 * mentira. O navegador de verdade e um adaptador em `harvest/playwright/`, que
 * nao tem teste unitario — nao existe jeito honesto de testar um navegador sem
 * um navegador, e navegar contra o LinkedIn a cada CI e o caminho mais curto
 * para derrubar a sessao.
 *
 * O desenho e deliberado: toda a decisao fica do lado testavel, e o lado
 * nao testavel so sabe clicar e ler atributo.
 */

/**
 * O que aconteceu ao abrir a busca.
 *
 * `signed-out` nao e falha de navegacao: e o sintoma de sessao caida, e manda o
 * runner parar tudo em vez de insistir nas buscas seguintes.
 */
export type SearchOpening =
  | { readonly outcome: 'opened' }
  | { readonly outcome: 'signed-out'; readonly url: string }
  | { readonly outcome: 'failed'; readonly reason: string };

export interface PostsPage {
  /** Navega e diz se a sessao sobreviveu. Nunca lanca. */
  open(url: string): Promise<SearchOpening>;

  /**
   * Rola a lista e expande os textos truncados, ate o teto de rolagens.
   *
   * Tolerante por contrato: botao que nao existe mais, seletor que mudou e
   * rolagem que nao rende nada sao normais numa pagina que muda sem aviso, e
   * nenhum deles pode interromper a colheita. No pior caso colhe-se o que
   * estava visivel.
   */
  revealMore(maxScrolls: number): Promise<void>;

  /** O HTML dos resultados, para o parser. Nunca lanca: falha devolve ''. */
  html(): Promise<string>;

  /**
   * O link permanente do card, pedido ao navegador.
   *
   * Existe porque no layout novo o id da publicacao NAO esta no DOM (RFC 001,
   * secao 5.3): o parser devolve `cardKey`, e so quem tem a pagina aberta
   * consegue chegar da chave ate a URL. `undefined` quando nao da — e card sem
   * URL e descartado, porque sem link nao ha data.
   */
  postUrl(cardKey: string): Promise<string | undefined>;
}
