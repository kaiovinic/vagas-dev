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

export const JOB_DESCRIPTION_WRITER = Symbol.for('JOB_DESCRIPTION_WRITER');

/** Uma descricao buscada na fonte, pronta para o cache. */
export interface FetchedDescription {
  readonly url: string;
  readonly description: string;
}

/**
 * Guarda a descricao buscada, inclusive a da vaga que nao vai ser gravada.
 *
 * Sem isto o cache de leitura so cobria vaga APROVADA, porque so a aprovada
 * chega a tabela de vagas. E a maioria dos cards do LinkedIn e reprovada pelas
 * regras — vaga de outro estado, de outra stack. Resultado: o teto de detalhes
 * por ciclo era gasto todo ciclo nos mesmos cards reprovados do topo da fila, e
 * a vaga que estava mais para baixo nunca chegava a ter descricao.
 *
 * Contrato de escrita separado do de leitura (ISP): o coletor le e escreve, o
 * painel nem sabe que este cache existe.
 */
export interface IJobDescriptionWriter {
  /** Grava ou atualiza as descricoes informadas. Devolve quantas gravou. */
  saveDescriptions(descriptions: readonly FetchedDescription[]): Promise<number>;
}
