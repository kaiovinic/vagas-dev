import type { RawJobProps } from '@/domain/dtos/raw-job-props';

/**
 * Token de multi-provider. Novos coletores sao registrados neste token e o
 * orquestrador nao precisa ser alterado (OCP).
 */
export const JOB_SCRAPERS = Symbol.for('JOB_SCRAPERS');

/**
 * Contrato de um coletor de vagas.
 *
 * Toda implementacao deve ser substituivel (LSP): nunca lanca excecao para fora,
 * devolvendo lista vazia quando a fonte falha ou muda de layout.
 */
export interface IJobScraperProvider {
  /** Identificador da fonte, usado em `Job.source` e nos graficos por fonte. */
  readonly source: string;

  /** Rotulo legivel da fonte para o dashboard. */
  readonly label: string;

  /**
   * Se a fonte ja pode ser visitada nesta captura.
   *
   * A maioria responde sempre `true` e e varrida a cada ciclo. Existe para a
   * fonte que custa cota: o orquestrador pergunta ANTES de chamar `scrape`,
   * de modo que uma fonte adiada nao conta como execucao na saude da coleta.
   * Sem isso, o proprio registro do ciclo adiado seria lido como "rodou
   * agora" e a fonte nunca mais chegaria a hora dela.
   */
  isDue(reference: Date): Promise<boolean>;

  /**
   * Se a fonte tem o que precisa para funcionar — credencial, endereco de
   * servico, o que seja.
   *
   * Quase toda fonte e um GET em pagina publica e responde sempre `true`.
   * Existe pelas duas que dependem de configuracao: sem ela, elas viram no-op
   * silencioso, o que e o comportamento certo (ambiente sem chave nao pode
   * quebrar as outras sete fontes) e ao mesmo tempo o mais perigoso — foi
   * assim que um `SERP_ENDPOINT` vazio no container tirou o coletor de
   * publicacoes do ar por cinco dias sem nenhum erro.
   *
   * E por isso que isto nao e detalhe de infraestrutura: a tabela de saude
   * pergunta antes de pintar uma fonte de verde.
   */
  isConfigured(): boolean;

  scrape(): Promise<RawJobProps[]>;
}
