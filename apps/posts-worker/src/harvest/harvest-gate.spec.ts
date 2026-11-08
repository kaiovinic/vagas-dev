import { describe, expect, it } from 'vitest';

import { EMPTY_HARVEST, type HarvestFile, type HarvestStatus } from '@/contract';
import { createScheduledTrigger, readHarvestGate } from '@/harvest/harvest-gate';
import type { HarvestStart } from '@/harvest/harvest-job';

const HARVESTED_AT = '2026-11-07T06:00:00.000Z';

function previous(status: HarvestStatus, harvestedAt: string | null = HARVESTED_AT): HarvestFile {
  return { ...EMPTY_HARVEST, status, harvestedAt };
}

function gate(
  status: HarvestStatus,
  writtenAt: Date | null,
  harvestedAt: string | null = HARVESTED_AT,
) {
  return readHarvestGate({
    sessionWrittenAt: () => Promise.resolve(writtenAt),
    previous: () => Promise.resolve(previous(status, harvestedAt)),
  });
}

describe('readHarvestGate', () => {
  it('colheita boa na vez anterior libera a proxima', async () => {
    await expect(gate('ok', new Date('2026-11-01T00:00:00.000Z'))).resolves.toEqual({
      allowed: true,
    });
  });

  it('colheita degradada tambem libera: foi a rede, nao a conta', async () => {
    await expect(gate('degraded', new Date('2026-11-01T00:00:00.000Z'))).resolves.toEqual({
      allowed: true,
    });
  });

  it('sem arquivo de sessao, nao ha o que tentar', async () => {
    const result = await gate('ok', null);

    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.reason).toContain('state.json');
    }
  });

  /**
   * O ponto do arquivo: insistir de 8 em 8 horas numa parede de login e o
   * padrao que faz o LinkedIn olhar a conta de perto, e nenhuma dessas
   * tentativas tem como dar certo.
   */
  it('sessao caida e nao renovada barra a colheita agendada', async () => {
    const result = await gate('session-lost', new Date('2026-11-07T05:00:00.000Z'));

    expect(result.allowed).toBe(false);

    if (!result.allowed) {
      expect(result.reason).toContain('session:login');
    }
  });

  /** O `session:login` reescreve o arquivo: e essa a evidencia de renovacao. */
  it('sessao reescrita depois da falha libera de novo', async () => {
    await expect(
      gate('session-lost', new Date('2026-11-07T07:00:00.000Z')),
    ).resolves.toEqual({ allowed: true });
  });

  it('sem colheita anterior datada, qualquer sessao serve', async () => {
    await expect(
      gate('session-lost', new Date('2026-11-07T07:00:00.000Z'), null),
    ).resolves.toEqual({ allowed: true });
  });
});

describe('createScheduledTrigger', () => {
  it('porta aberta, dispara a colheita', async () => {
    const trigger = createScheduledTrigger({
      gate: () => Promise.resolve({ allowed: true }),
      start: () => Promise.resolve<HarvestStart>('started'),
      log: () => undefined,
    });

    await expect(trigger()).resolves.toBe('started');
  });

  it('porta fechada, nao abre navegador e diz por que', async () => {
    const lines: string[] = [];
    let started = false;
    const trigger = createScheduledTrigger({
      gate: () => Promise.resolve({ allowed: false, reason: 'sessao caida' }),
      start: () => {
        started = true;

        return Promise.resolve<HarvestStart>('started');
      },
      log: (message) => lines.push(message),
    });

    await expect(trigger()).resolves.toBe('no-session');
    expect(started).toBe(false);
    expect(lines[0]).toContain('sessao caida');
  });
});
