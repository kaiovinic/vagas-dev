export const JOB_CLOSURE_PROVIDERS = Symbol.for('JOB_CLOSURE_PROVIDERS');

/**
 * Fonte capaz de dizer que uma vaga FOI ENCERRADA.
 *
 * E um contrato separado do `IJobScraperProvider` de proposito (ISP): a maioria
 * das fontes apenas para de listar a vaga, sem nunca declarar que ela acabou, e
 * obrigar as oito a implementar um metodo que so uma sabe responder encheria as
 * outras sete de `return []`.
 *
 * Hoje quem implementa e o coletor do GitHub, onde o encerramento e explicito:
 * a issue e fechada. Quem implementar depois entra na lista
 * `JOB_CLOSURE_PROVIDERS` sem que o caso de uso mude (OCP).
 */
export interface IJobClosureProvider {
  /** Mesma identificacao do coletor, para o log dizer de onde veio. */
  readonly source: string;

  /**
   * Urls das vagas que a fonte declarou encerradas.
   *
   * Nao deve lancar excecao: fonte fora do ar devolve lista vazia, do mesmo
   * jeito que o `scrape` (LSP).
   */
  findClosedJobUrls(): Promise<readonly string[]>;
}
