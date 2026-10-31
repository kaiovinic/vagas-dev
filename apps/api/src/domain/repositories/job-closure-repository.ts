export const JOB_CLOSURE_WRITER = Symbol.for('JOB_CLOSURE_WRITER');

/**
 * Contrato de escrita do encerramento (ISP): marca vaga como encerrada e nada
 * mais. Nao e um metodo a mais no `IJobWriteRepository` porque quem encerra nao
 * tem nada a ver com quem persiste a captura — sao dois casos de uso.
 */
export interface IJobClosureWriter {
  /**
   * Marca como encerradas as vagas das urls informadas que ainda estao abertas.
   *
   * Devolve quantas mudaram de estado neste momento, nao quantas urls vieram:
   * vaga ja encerrada em um ciclo anterior nao conta de novo, e url que o radar
   * nunca gravou nao conta nenhuma vez.
   */
  closeByUrl(urls: readonly string[], closedAt: Date): Promise<number>;
}
