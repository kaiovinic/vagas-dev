import { beforeEach, describe, expect, it } from 'vitest';

import {
  DispatchPendingAlertsUseCase,
  MAX_ALERTS_PER_DISPATCH,
} from '@/application/use-cases/dispatch-pending-alerts.use-case';
import type { PendingJobAlert } from '@/domain/repositories/job-alert-repository';
import {
  FakeTelegramNotifier,
  InMemoryPendingAlertRepository,
} from '../../../test/factories/doubles';
import { FIXED_NOW, makeJob } from '../../../test/factories/make-job';

function pending(jobId: string, company = jobId): PendingJobAlert {
  return { jobId, alert: { job: makeJob({ company }), tags: ['React'], scope: 'NATIONAL' } };
}

describe('DispatchPendingAlertsUseCase', () => {
  let pendentes: InMemoryPendingAlertRepository;
  let notifier: FakeTelegramNotifier;
  let useCase: DispatchPendingAlertsUseCase;

  beforeEach(() => {
    pendentes = new InMemoryPendingAlertRepository();
    notifier = new FakeTelegramNotifier();
    useCase = new DispatchPendingAlertsUseCase(pendentes, notifier);
  });

  it('nao chama o Telegram quando nao ha nada pendente', async () => {
    const report = await useCase.execute(FIXED_NOW);

    expect(report).toEqual({ totalSent: 0, totalFailed: 0 });
    expect(notifier.notified).toHaveLength(0);
  });

  it('envia cada alerta pendente e marca a vaga como avisada', async () => {
    pendentes.pending = [pending('1', 'Acme Corp'), pending('2', 'Globex')];

    const report = await useCase.execute(FIXED_NOW);

    expect(report).toEqual({ totalSent: 2, totalFailed: 0 });
    expect(notifier.notified.map((alerta) => alerta.job.company)).toEqual(['Acme Corp', 'Globex']);
    expect([...pendentes.notifiedAt.keys()]).toEqual(['1', '2']);
    expect(pendentes.pending).toHaveLength(0);
  });

  it('nao reenvia o que ja foi avisado no despacho anterior', async () => {
    pendentes.pending = [pending('1')];

    await useCase.execute(FIXED_NOW);
    const report = await useCase.execute(FIXED_NOW);

    expect(report.totalSent).toBe(0);
    expect(notifier.notified).toHaveLength(1);
  });

  it('deixa pendente o alerta que falhou, sem marcar a vaga', async () => {
    pendentes.pending = [pending('1')];
    notifier.shouldFail = true;

    const report = await useCase.execute(FIXED_NOW);

    expect(report).toEqual({ totalSent: 0, totalFailed: 1 });
    expect(pendentes.notifiedAt.size).toBe(0);
    expect(pendentes.pending).toHaveLength(1);
  });

  it('registra tambem a falha que nao e Error, sem perder a vaga', async () => {
    pendentes.pending = [pending('1')];
    notifier.onNotify = () => {
      throw 'ECONNRESET cru';
    };

    const report = await useCase.execute(FIXED_NOW);

    expect(report).toEqual({ totalSent: 0, totalFailed: 1 });
    expect(pendentes.pending).toHaveLength(1);
  });

  it('sai no despacho seguinte quando o Telegram volta', async () => {
    pendentes.pending = [pending('1', 'Acme Corp')];
    notifier.shouldFail = true;

    await useCase.execute(FIXED_NOW);
    notifier.shouldFail = false;

    const report = await useCase.execute(FIXED_NOW);

    expect(report.totalSent).toBe(1);
    expect(notifier.notified.map((alerta) => alerta.job.company)).toEqual(['Acme Corp']);
  });

  it('uma falha no meio nao impede as proximas de sair', async () => {
    pendentes.pending = [pending('1', 'Acme Corp'), pending('2', 'Globex'), pending('3', 'Initech')];
    let chamada = 0;

    notifier.onNotify = () => {
      chamada += 1;
      notifier.shouldFail = chamada === 2;
    };

    const report = await useCase.execute(FIXED_NOW);

    expect(report).toEqual({ totalSent: 2, totalFailed: 1 });
    expect(notifier.notified.map((alerta) => alerta.job.company)).toEqual(['Acme Corp', 'Initech']);
    expect(pendentes.pending.map((entry) => entry.jobId)).toEqual(['2']);
  });

  it('respeita o teto de alertas por despacho', async () => {
    pendentes.pending = Array.from({ length: MAX_ALERTS_PER_DISPATCH + 5 }, (_, index) =>
      pending(String(index)),
    );

    const report = await useCase.execute(FIXED_NOW);

    expect(report.totalSent).toBe(MAX_ALERTS_PER_DISPATCH);
    expect(pendentes.pending).toHaveLength(5);
  });

  it('aceita um limite menor, para quem chama poder reduzir a rajada', async () => {
    pendentes.pending = [pending('1'), pending('2')];

    const report = await useCase.execute(FIXED_NOW, 1);

    expect(report.totalSent).toBe(1);
    expect(pendentes.pending).toHaveLength(1);
  });

  it('um despacho por vez: a segunda chamada aguarda a primeira, sem duplicar envio', async () => {
    pendentes.pending = [pending('1')];

    const [primeiro, segundo] = await Promise.all([
      useCase.execute(FIXED_NOW),
      useCase.execute(FIXED_NOW),
    ]);

    expect(primeiro).toEqual({ totalSent: 1, totalFailed: 0 });
    expect(segundo).toEqual(primeiro);
    expect(notifier.notified).toHaveLength(1);
  });

  it('volta a despachar depois que o anterior termina', async () => {
    pendentes.pending = [pending('1')];
    await useCase.execute(FIXED_NOW);

    pendentes.pending = [pending('2')];
    const report = await useCase.execute(FIXED_NOW);

    expect(report.totalSent).toBe(1);
    expect(notifier.notified).toHaveLength(2);
  });
});
