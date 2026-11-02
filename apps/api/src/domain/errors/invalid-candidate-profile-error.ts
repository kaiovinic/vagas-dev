/**
 * Erro de dominio lancado quando os dados enviados nao formam um perfil valido.
 *
 * E separado do `InvalidJobError` porque a origem e outra: ali os dados vem de
 * um coletor e um perfil invalido significa fonte quebrada; aqui vem do proprio
 * usuario pelo painel, e a mensagem precisa dizer qual campo corrigir.
 */
export class InvalidCandidateProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCandidateProfileError';
  }
}
