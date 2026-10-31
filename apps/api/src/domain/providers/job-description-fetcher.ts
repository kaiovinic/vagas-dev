export const JOB_DESCRIPTION_FETCHERS = Symbol('JOB_DESCRIPTION_FETCHERS');

/**
 * Busca a descricao de UMA vaga ja gravada, pela url.
 *
 * Existe porque a fila da coleta nao e garantia de cobertura. O coletor do
 * LinkedIn ve, por ciclo, os primeiros cards de cada busca; o conjunto gira, e
 * um anuncio que esteja fundo numa busca pode nao voltar a aparecer no teto de
 * detalhes de nenhum ciclo. Medido em producao: com 121 descricoes em cache e
 * 108 cards por ciclo, nove vagas gravadas sem descricao continuaram sem
 * descricao depois de tres ciclos.
 *
 * Contrato separado do `IJobScraperProvider` (ISP): quem coleta uma lista nao
 * precisa saber responder sobre uma vaga avulsa, e so o LinkedIn implementa os
 * dois.
 */
export interface IJobDescriptionFetcher {
  readonly source: string;

  /**
   * Descricao da vaga, ou string vazia quando a fonte nao a tem mais.
   *
   * Nao lanca: fonte fora do ar devolve vazio, e a vaga e tentada no proximo
   * ciclo (LSP, como no `IJobScraperProvider`).
   */
  fetchDescriptionFor(url: string): Promise<string>;
}
