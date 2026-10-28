export const CAPTURE_SCHEDULE = Symbol.for('CAPTURE_SCHEDULE');

/**
 * Porta do agendamento das capturas.
 *
 * Existe para o caso de uso nao depender do `@nestjs/schedule`: ele so pergunta
 * "quando e a proxima captura", e quem responde e a infraestrutura que conhece o
 * cron de verdade.
 */
export interface ICaptureSchedule {
  /**
   * Instante do proximo disparo agendado.
   *
   * `reference` e o momento da captura atual, usado apenas como base quando o
   * agendador nao esta disponivel (script avulso, teste, cron nao registrado).
   */
  nextRunAt(reference: Date): Date;
}
