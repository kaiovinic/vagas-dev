/**
 * Erros de dominio do gerador de curriculo.
 *
 * Sao tres porque cada um pede uma resposta diferente do painel: vaga que nao
 * existe e 404, perfil incompleto e 422 (o usuario conserta), e falha do
 * provedor e 502 — nao ha o que o usuario faca alem de tentar de novo.
 */
export class ResumeTargetNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Vaga ${jobId} nao encontrada`);
    this.name = 'ResumeTargetNotFoundError';
  }
}

export class ProfileNotReadyForResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileNotReadyForResumeError';
  }
}

/** Falha do provedor de IA, ja traduzida: o `APIError` do SDK nao sobe daqui. */
export class ResumeGenerationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeGenerationFailedError';
  }
}
