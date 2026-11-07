import { describe, expect, it } from 'vitest';

import type { HarvestStart } from '@/harvest/harvest-job';
import {
  BOOT_DELAY_IN_MS,
  firstDelayInMs,
  nextDelayInMs,
  scheduleWithTimeout,
  startHarvestScheduler,
  type SchedulerDeps,
} from '@/harvest/harvest-scheduler';

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const NOW = new Date('2026-11-07T12:00:00.000Z');

/**
 * O relogio de mentira: guarda as esperas pedidas e dispara quando o teste
 * manda. Agendador testado com `sleep` e agendador que nao e testado.
 */
class FakeClock {
  readonly delays: number[] = [];

  private pending: (() => void) | undefined;

  readonly schedule = (run: () => void, delayInMs: number): { cancel: () => void } => {
    this.delays.push(delayInMs);
    this.pending = run;

    return {
      cancel: () => {
        this.pending = undefined;
        this.cancels += 1;
      },
    };
  };

  cancels = 0;

  fire(): void {
    const run = this.pending;

    this.pending = undefined;
    run?.();
  }
}

function deps(
  clock: FakeClock,
  overrides: Partial<SchedulerDeps> = {},
): SchedulerDeps {
  return {
    intervalInMs: 8 * HOUR,
    jitterInMs: 20 * MINUTE,
    trigger: () => Promise.resolve<HarvestStart>('started'),
    lastHarvestedAt: null,
    now: () => NOW,
    random: () => 0.5,
    schedule: clock.schedule,
    log: () => undefined,
    ...overrides,
  };
}

/** O laco do agendador roda em microtarefas: isto deixa elas acontecerem. */
function flush(): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, 0);
  });
}

describe('nextDelayInMs', () => {
  it('sorteio no meio devolve o intervalo cheio', () => {
    expect(nextDelayInMs({ intervalInMs: 8 * HOUR, jitterInMs: 20 * MINUTE, random: () => 0.5 })).toBe(
      8 * HOUR,
    );
  });

  it('sorteio nos extremos anda o intervalo para tras e para frente', () => {
    const input = { intervalInMs: 8 * HOUR, jitterInMs: 20 * MINUTE };

    expect(nextDelayInMs({ ...input, random: () => 0 })).toBe(8 * HOUR - 20 * MINUTE);
    expect(nextDelayInMs({ ...input, random: () => 1 })).toBe(8 * HOUR + 20 * MINUTE);
  });

  /** Sem o piso, jitter maior que o intervalo renderia colheita em rajada. */
  it('nunca devolve menos de um minuto', () => {
    expect(nextDelayInMs({ intervalInMs: 2 * MINUTE, jitterInMs: 10 * MINUTE, random: () => 0 })).toBe(
      MINUTE,
    );
  });
});

describe('firstDelayInMs', () => {
  const base = { intervalInMs: 8 * HOUR, jitterInMs: 20 * MINUTE, now: () => NOW };

  it('sem colheita anterior espera a folga de boot, e nao o intervalo', () => {
    const delay = firstDelayInMs({ ...base, lastHarvestedAt: null, random: () => 0 });

    expect(delay).toBe(BOOT_DELAY_IN_MS);
  });

  /** Container em loop de restart colhendo a cada subida chama atencao. */
  it('colheita vencida tambem espera a folga de boot, com sorteio por cima', () => {
    const delay = firstDelayInMs({
      ...base,
      lastHarvestedAt: new Date('2026-11-07T00:00:00.000Z'),
      random: () => 1,
    });

    expect(delay).toBe(BOOT_DELAY_IN_MS + 20 * MINUTE);
  });

  /**
   * O ponto do calculo: a idade da colheita que esta no volume conta. Sem isso
   * um worker reiniciado toda manha nunca chegaria ao fim do intervalo.
   */
  it('colheita recente espera so o que falta do intervalo', () => {
    const delay = firstDelayInMs({
      ...base,
      lastHarvestedAt: new Date('2026-11-07T10:00:00.000Z'),
      random: () => 0.5,
    });

    expect(delay).toBe(6 * HOUR);
  });
});

describe('startHarvestScheduler', () => {
  it('agenda a primeira colheita sem disparar nada agora', () => {
    const clock = new FakeClock();
    let triggers = 0;

    startHarvestScheduler(
      deps(clock, {
        trigger: () => {
          triggers += 1;

          return Promise.resolve<HarvestStart>('started');
        },
      }),
    );

    expect(clock.delays).toEqual([BOOT_DELAY_IN_MS + 10 * MINUTE]);
    expect(triggers).toBe(0);
  });

  it('cada disparo agenda o seguinte', async () => {
    const clock = new FakeClock();

    startHarvestScheduler(deps(clock));

    clock.fire();
    await flush();

    expect(clock.delays).toEqual([BOOT_DELAY_IN_MS + 10 * MINUTE, 8 * HOUR]);
  });

  it('conta no diario o que o disparo respondeu', async () => {
    const clock = new FakeClock();
    const lines: string[] = [];

    startHarvestScheduler(
      deps(clock, {
        log: (message) => lines.push(message),
        trigger: () => Promise.resolve<HarvestStart>('no-session'),
      }),
    );

    clock.fire();
    await flush();

    expect(lines[0]).toContain('Proxima colheita em');
    expect(lines[1]).toContain('no-session');
  });

  it('parar cancela a proxima colheita', () => {
    const clock = new FakeClock();

    startHarvestScheduler(deps(clock)).stop();

    expect(clock.cancels).toBe(1);
  });

  /** Parar durante um disparo nao pode reagendar pelas costas do encerramento. */
  it('parado durante o disparo, nao agenda outro', async () => {
    const clock = new FakeClock();
    let release: (() => void) | undefined;
    const scheduler = startHarvestScheduler(
      deps(clock, {
        trigger: () =>
          new Promise<HarvestStart>((done) => {
            release = () => done('started');
          }),
      }),
    );

    clock.fire();
    scheduler.stop();
    release?.();
    await flush();

    expect(clock.delays).toEqual([BOOT_DELAY_IN_MS + 10 * MINUTE]);
  });
});

describe('scheduleWithTimeout', () => {
  it('dispara depois do prazo', async () => {
    let fired = false;

    scheduleWithTimeout(() => {
      fired = true;
    }, 1);

    await flush();

    expect(fired).toBe(true);
  });

  it('cancelado, nao dispara', async () => {
    let fired = false;

    scheduleWithTimeout(() => {
      fired = true;
    }, 1).cancel();

    await flush();

    expect(fired).toBe(false);
  });
});
