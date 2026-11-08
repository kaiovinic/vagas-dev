import type { HarvestFile } from '@/contract';
import type { HarvestStart } from '@/harvest/harvest-job';

/**
 * A porta que o agendador tem que passar — e que o disparo a mao nao tem.
 *
 * O RFC 001 (secao 9) promete que a colheita **para de tentar** depois de perder
 * a sessao, em vez de bater de oito em oito horas numa parede de login: insistir
 * com sessao morta e justamente o padrao que faz o LinkedIn olhar a conta de
 * perto, e nenhuma dessas tentativas tem como dar certo.
 *
 * A evidencia de que vale tentar de novo e o arquivo da sessao ter sido
 * reescrito DEPOIS da colheita que falhou: e isso que o `session:login` faz.
 * Nada de contador em arquivo — a data de gravacao ja responde a pergunta, e
 * nao precisa ser mantida em sincronia com nada.
 */
export type HarvestGate =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export interface HarvestGateDeps {
  readonly sessionWrittenAt: () => Promise<Date | null>;
  readonly previous: () => Promise<HarvestFile>;
}

export async function readHarvestGate(deps: HarvestGateDeps): Promise<HarvestGate> {
  const [writtenAt, previous] = await Promise.all([deps.sessionWrittenAt(), deps.previous()]);

  if (writtenAt === null) {
    return { allowed: false, reason: 'sem sessao gravada (state.json): esperando o login' };
  }

  if (previous.status !== 'session-lost') {
    return { allowed: true };
  }

  return renewedAfter(writtenAt, previous.harvestedAt)
    ? { allowed: true }
    : {
        allowed: false,
        reason: 'a sessao caiu e nao foi renovada: refaca o login (npm run session:login)',
      };
}

/** Colheita sem data e colheita que nunca houve: qualquer sessao e mais nova. */
function renewedAfter(writtenAt: Date, harvestedAt: string | null): boolean {
  if (harvestedAt === null) {
    return true;
  }

  return writtenAt.getTime() > new Date(harvestedAt).getTime();
}

export interface ScheduledTriggerDeps {
  readonly gate: () => Promise<HarvestGate>;
  readonly start: () => Promise<HarvestStart>;
  readonly log: (message: string) => void;
}

/**
 * O disparo do agendador: confere a porta e, so entao, colhe.
 *
 * O `POST /harvest` NAO passa por aqui de proposito. Quem bate naquela rota
 * acabou de fazer algo — refez o login, mexeu num seletor — e sabe mais sobre o
 * estado da conta que qualquer regra deste arquivo.
 */
export function createScheduledTrigger(deps: ScheduledTriggerDeps): () => Promise<HarvestStart> {
  return async () => {
    const gate = await deps.gate();

    if (!gate.allowed) {
      deps.log(`Colheita agendada nao vai sair: ${gate.reason}`);

      return 'no-session';
    }

    return await deps.start();
  };
}
