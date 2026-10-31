export const JOB_DESCRIPTION_READER = Symbol.for('JOB_DESCRIPTION_READER');

/**
 * Descricoes ja capturadas, por URL da vaga.
 *
 * Contrato de leitura proprio, e nao um metodo a mais no `IJobQueryRepository`
 * (ISP): quem precisa disto e um coletor, que nao tem nada a ver com paginacao,
 * filtros nem metricas do painel.
 *
 * Existe por economia de requisicao. A busca guest do LinkedIn devolve o card
 * sem descricao, e buscar o detalhe de cada vaga a cada ciclo significaria
 * repetir dezenas de requisicoes a cada duas horas para texto que nao muda. Com
 * este contrato, o coletor pergunta primeiro o que ja sabe e so vai a rede pelo
 * que e novo.
 */
export interface IJobDescriptionReader {
  /**
   * URL -> descricao, apenas das vagas que ja tem descricao gravada. URL sem
   * descricao (ou que nunca foi vista) simplesmente nao aparece no resultado,
   * e e o que o coletor usa para decidir o que buscar.
   */
  findDescriptionsByUrl(urls: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
