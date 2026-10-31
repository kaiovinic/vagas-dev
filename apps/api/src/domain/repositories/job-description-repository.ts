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

export const MISSING_DESCRIPTION_REPOSITORY = Symbol.for('MISSING_DESCRIPTION_REPOSITORY');

/**
 * As vagas gravadas que ficaram sem descricao, e o conserto delas.
 *
 * Uma vaga aprovada antes de o detalhe ser buscado entra no banco com a
 * descricao vazia, e nada no caminho de gravacao reescreve vaga existente: a
 * linha ficaria vazia pelos tres dias em que aparece no feed. Este contrato e o
 * que permite voltar nela pela url, sem depender de o card reaparecer na busca.
 */
export interface IMissingDescriptionRepository {
  /** Urls de vagas abertas daquela fonte que estao sem descricao, as mais recentes primeiro. */
  findUrlsMissingDescription(source: string, limit: number): Promise<readonly string[]>;

  /**
   * Grava a descricao da vaga daquela url, se ela ainda estiver vazia.
   *
   * Devolve quantas linhas mudaram: zero significa que outra captura chegou
   * antes, e nao erro.
   */
  fillDescriptionByUrl(url: string, description: string): Promise<number>;
}
