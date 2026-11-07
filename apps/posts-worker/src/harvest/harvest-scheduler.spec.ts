import { describe, expect, it } from 'vitest';

import type { ActivityWindow } from '@/harvest/activity-window';
import type { HarvestStart } from '@/harvest/harvest-job';
import {
  BOOT_DELAY_IN_MS,
  firstDelayInMs,
  nextDelayInMs,
  scheduleWithTimeout,
  startHarvestScheduler,
  withinWindow,
  type SchedulerDeps,
} from '@/harvest/harvest-scheduler';

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

/** 12:00Z = 09:00 na Bahia: dentro da janela, onde os testes antigos vivem. */
const NOW = new Date('2026-11-07T12:00:00.000Z');

const BAHIA: ActivityWindow = { startHour: 8, endHour: 22, timeZone: 'America/Bahia' };

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
    window: BAHIA,
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

describe('withinWindow', () => {
  const base = { intervalInMs: 8 * HOUR, jitterInMs: 20 * MINUTE, window: BAHIA };

  /** Meio da tarde: nada a corrigir, a espera sai como veio. */
  it('espera que cai dentro da janela passa intacta', () => {
    const delay = withinWindow(2 * HOUR, { ...base, now: () => NOW, random: () => 0.5 });

    expect(delay).toBe(2 * HOUR);
  });

  /**
   * O caso que motivou a janela: um disparo que cairia as 23h local vira
   * colheita das 8h da manha seguinte, com o sorteio por cima.
   */
  it('espera que cai as 23h local anda para a abertura do dia seguinte', () => {
    // 09:00 local + 14h = 23:00 local; a abertura seguinte e 08:00 (+23h).
    const delay = withinWindow(14 * HOUR, { ...base, now: () => NOW, random: () => 0 });

    expect(delay).toBe(23 * HOUR);
  });

  it('o sorteio entra sobre a abertura, para nao colher as 08:00:00 em ponto', () => {
    const delay = withinWindow(14 * HOUR, { ...base, now: () => NOW, random: () => 1 });

    expect(delay).toBe(23 * HOUR + 20 * MINUTE);
  });

  /** Madrugada: a abertura e no mesmo dia, e nao no seguinte. */
  it('espera que cai as 03h local anda para as 08h do mesmo dia', () => {
    const dawn = new Date('2026-11-07T05:00:00.000Z');

    const delay = withinWindow(HOUR, { ...base, now: () => dawn, random: () => 0 });

    expect(delay).toBe(6 * HOUR);
  });

  it('nunca devolve menos de um minuto', () => {
    // 07:59:30 local: a abertura esta a 30 s, e o piso do agendador vale.
    const beforeOpening = new Date('2026-11-07T10:59:30.000Z');

    const delay = withinWindow(0, { ...base, now: () => beforeOpening, random: () => 0 });

    expect(delay).toBe(MINUTE);
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

  /**
   * O agendador inteiro, de ponta a ponta: com o worker subindo as 20h local e
   * intervalo de 8 h, a colheita seguinte cairia as 04h — e nao cai.
   */
  it('a colheita seguinte nao e marcada para a madrugada', async () => {
    const clock = new FakeClock();
    const evening = new Date('2026-11-07T23:00:00.000Z');

    startHarvestScheduler(
      deps(clock, { now: () => evening, random: () => 0, lastHarvestedAt: evening }),
    );

    clock.fire();
    await flush();

    // 20:00 local + 8 h = 04:00; a abertura seguinte esta a 12 h de distancia.
    expect(clock.delays[1]).toBe(12 * HOUR);
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
