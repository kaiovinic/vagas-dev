export const OPERATIONAL_ALERTER = Symbol.for('OPERATIONAL_ALERTER');

/**
 * Um aviso sobre a propria coleta, nao sobre uma vaga.
 *
 * `action` existe porque este alerta sempre pede algo de uma pessoa: um aviso
 * de infraestrutura que nao diz o que fazer vira ruido que se aprende a
 * ignorar.
 */
export interface OperationalAlert {
  /** Fonte afetada, como aparece na tabela de saude. */
  readonly source: string;
  readonly title: string;
  readonly detail: string;
  /** O que a pessoa precisa fazer para resolver. */
  readonly action: string;
}

/**
 * Porta de alerta operacional.
 *
 * Separada da `ITelegramNotifier` (ISP), ainda que hoje a mesma classe
 * implemente as duas e o destino seja o mesmo chat. O motivo e que os dois
 * alertas nao tem nada em comum alem do transporte: um fala de vaga nova para
 * quem procura emprego, outro fala de sessao caida para quem mantem o sistema.
 * Um coletor que precisa avisar de sessao caida nao tem o que fazer com
 * `notifyNewJob` nem com o resumo semanal.
 *
 * Ao contrario da porta de vagas, aqui a falha de envio NAO precisa chegar a
 * quem chama: perder um aviso operacional nao pode derrubar uma captura. Mesmo
 * assim este metodo rejeita quando o envio falha, e e quem chama que decide
 * engolir — a porta nao esconde o erro, so nao o torna fatal.
 */
export interface IOperationalAlerter {
  notifyOperational(alert: OperationalAlert): Promise<void>;
}
