import { describe, expect, it, vi } from 'vitest';

import {
  ALERT_DISPATCH_CRON,
  ALERT_DISPATCH_JOB_NAME,
  AlertDispatchScheduler,
} from '@/application/schedulers/alert-dispatch.scheduler';
import type { DispatchPendingAlertsUseCase } from '@/application/use-cases/dispatch-pending-alerts.use-case';

function schedulerWith(execute: ReturnType<typeof vi.fn>): AlertDispatchScheduler {
  return new AlertDispatchScheduler({ execute } as unknown as DispatchPendingAlertsUseCase);
}

describe('AlertDispatchScheduler', () => {
  it('despacha os alertas pendentes no disparo agendado', async () => {
    const execute = vi.fn().mockResolvedValue({ totalSent: 2, totalFailed: 0 });

    await schedulerWith(execute).handleScheduledDispatch();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('nao deixa a falha do despacho derrubar o agendador', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('banco indisponivel'));

    await expect(schedulerWith(execute).run()).resolves.toBeUndefined();
  });

  it('registra tambem a falha que nao e Error', async () => {
    const execute = vi.fn().mockRejectedValue('conexao recusada');

    await expect(schedulerWith(execute).run()).resolves.toBeUndefined();
  });

  it('roda a cada dez minutos, para o que falhou nao esperar a proxima captura', () => {
    expect(ALERT_DISPATCH_CRON).toBe('0 */10 * * * *');
    expect(ALERT_DISPATCH_JOB_NAME).toBe('alert-dispatch');
  });
});
