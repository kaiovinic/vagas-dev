/**
 * Erro de dominio lancado quando os dados brutos capturados nao formam uma vaga valida.
 */
export class InvalidJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobError';
  }
}
