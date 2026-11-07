import type { HarvestStart } from '@/harvest/harvest-job';

/**
 * O relogio da colheita, dentro do proprio worker.
 *
 * Nao e cron do sistema por um motivo pratico: o container ja tem um processo de
 * pe (o Fastify) e um volume com a sessao. Um cron do host precisaria de
 * `docker exec`, que e mais uma coisa para configurar na VPS e mais um jeito de
 * a colheita silenciar sem ninguem notar.
 *
 * Tudo que decide entra por parametro — o relogio, o sorteio, o disparo — porque
 * agendador testado com `sleep` e agendador que nao e testado.
 */

/** Piso de qualquer espera: o jitter nunca pode virar colheita em rajada. */
const MIN_DELAY_IN_MS = 60_000;

/**
 * Espera ao subir, quando a colheita ja esta vencida.
 *
 * Nao e zero de proposito: container que reinicia em loop colheria a cada
 * restart, e e justamente isso que faz o LinkedIn olhar a conta de perto.
 */
export const BOOT_DELAY_IN_MS = 120_000;

export interface ScheduledTimer {
  cancel(): void;
}

export interface SchedulerDeps {
  readonly intervalInMs: number;
  /** Variacao sorteada para cada lado: colher sempre no mesmo segundo e padrao. */
  readonly jitterInMs: number;
  readonly trigger: () => Promise<HarvestStart>;
  /** Quando foi a ultima colheita; `null` quando nunca houve nenhuma. */
  readonly lastHarvestedAt: Date | null;
  readonly now: () => Date;
  readonly random: () => number;
  readonly schedule: (run: () => void, delayInMs: number) => ScheduledTimer;
  readonly log: (message: string) => void;
}

export interface HarvestScheduler {
  /** Cancela a proxima colheita. Nao interrompe a que estiver em curso. */
  stop(): void;
}

export interface DelayInput {
  readonly intervalInMs: number;
  readonly jitterInMs: number;
  readonly random: () => number;
}

/**
 * Liga o agendador e devolve o jeito de desliga-lo.
 *
 * Nao dispara nada agora: a primeira colheita fica a `firstDelayInMs` de
 * distancia, que respeita a idade da colheita que ja esta no volume.
 */
export function startHarvestScheduler(deps: SchedulerDeps): HarvestScheduler {
  let timer: ScheduledTimer | undefined;
  let stopped = false;

  const plan = (delayInMs: number): void => {
    if (stopped) {
      return;
    }

    deps.log(`Proxima colheita em ${Math.round(delayInMs / 60_000)} min`);
    timer = deps.schedule(() => void fire(), delayInMs);
  };

  const fire = async (): Promise<void> => {
    deps.log(`Colheita agendada: ${await deps.trigger()}`);
    plan(nextDelayInMs(deps));
  };

  plan(firstDelayInMs(deps));

  return {
    stop: () => {
      stopped = true;
      timer?.cancel();
    },
  };
}

/**
 * Intervalo com o sorteio em volta: `intervalo ± jitter`.
 *
 * O sorteio nao e enfeite. Colher as 03:00:07 todos os dias e assinatura de
 * robo, e o que este projeto nao pode perder e a conta (RFC 001, secao 14).
 */
export function nextDelayInMs(input: DelayInput): number {
  const spread = (input.random() * 2 - 1) * input.jitterInMs;

  return Math.max(MIN_DELAY_IN_MS, Math.round(input.intervalInMs + spread));
}

/**
 * A primeira colheita depois de subir.
 *
 * Conta a idade da colheita que esta no volume em vez de comecar o intervalo do
 * zero: sem isso, um worker reiniciado todo dia antes do intervalo vencer nunca
 * colheria — e o painel mostraria uma fonte parada sem nenhum erro para ver.
 */
export function firstDelayInMs(
  input: DelayInput & { readonly lastHarvestedAt: Date | null; readonly now: () => Date },
): number {
  const remaining = remainingInMs(input.lastHarvestedAt, input.now(), input.intervalInMs);

  if (remaining <= 0) {
    return BOOT_DELAY_IN_MS + Math.round(input.random() * input.jitterInMs);
  }

  return nextDelayInMs({ ...input, intervalInMs: remaining });
}

function remainingInMs(lastHarvestedAt: Date | null, now: Date, intervalInMs: number): number {
  if (lastHarvestedAt === null) {
    return 0;
  }

  return lastHarvestedAt.getTime() + intervalInMs - now.getTime();
}

/** O agendador de verdade: `setTimeout`, e nada mais. */
export function scheduleWithTimeout(run: () => void, delayInMs: number): ScheduledTimer {
  const timer = setTimeout(run, delayInMs);

  return { cancel: () => clearTimeout(timer) };
}
