import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DIGEST_PERIOD_IN_DAYS,
  SendWeeklyDigestUseCase,
  TOP_TECHNOLOGIES,
} from '@/application/use-cases/send-weekly-digest.use-case';
import type {
  IWeeklyDigestRepository,
  WeeklyDigestSnapshot,
} from '@/domain/repositories/weekly-digest-repository';
import type { ITelegramNotifier, WeeklyDigest } from '@/domain/providers/telegram-notifier';
import { FIXED_NOW } from '../../../test/factories/make-job';

const SNAPSHOT: WeeklyDigestSnapshot = {
  openJobs: 88,
  newInPeriod: 134,
  remoteJobs: 74,
  localJobs: 14,
  technologies: [
    { id: 'React', label: 'React', total: 61 },
    { id: 'Node.js', label: 'Node.js', total: 44 },
    { id: 'TypeScript', label: 'TypeScript', total: 39 },
    { id: 'Angular', label: 'Angular', total: 21 },
    { id: '.NET', label: '.NET', total: 18 },
    { id: 'Next.js', label: 'Next.js', total: 9 },
    { id: 'C#', label: 'C#', total: 0 },
  ],
};

function build(snapshot: WeeklyDigestSnapshot = SNAPSHOT): {
  readonly useCase: SendWeeklyDigestUseCase;
  readonly summarize: ReturnType<typeof vi.fn>;
  readonly notify: ReturnType<typeof vi.fn>;
} {
  const summarize = vi.fn().mockResolvedValue(snapshot);
  const notify = vi.fn().mockResolvedValue(undefined);
  const repository = { summarize } as unknown as IWeeklyDigestRepository;
  const notifier = {
    notifyNewJob: vi.fn(),
    notifyWeeklyDigest: notify,
  } as unknown as ITelegramNotifier;

  return { useCase: new SendWeeklyDigestUseCase(repository, notifier), summarize, notify };
}

function sentDigest(notify: ReturnType<typeof vi.fn>): WeeklyDigest {
  return notify.mock.calls[0]?.[0] as WeeklyDigest;
}

describe('SendWeeklyDigestUseCase', () => {
  let setup: ReturnType<typeof build>;

  beforeEach(() => {
    setup = build();
  });

  describe('consulta', () => {
    it('consolida a semana de sete dias', async () => {
      await setup.useCase.execute(FIXED_NOW);

      expect(DIGEST_PERIOD_IN_DAYS).toBe(7);
      expect(setup.summarize).toHaveBeenCalledWith(FIXED_NOW, 7, expect.any(Array));
    });

    it('pede a contagem de toda a stack monitorada', async () => {
      await setup.useCase.execute(FIXED_NOW);

      const buckets = setup.summarize.mock.calls[0]?.[2] as { label: string }[];

      expect(buckets.map((bucket) => bucket.label)).toContain('React');
      expect(buckets.map((bucket) => bucket.label)).toContain('.NET');
    });
  });

  describe('resumo enviado', () => {
    it('repassa os totais consolidados', async () => {
      await setup.useCase.execute(FIXED_NOW);

      expect(sentDigest(setup.notify)).toMatchObject({
        openJobs: 88,
        newInPeriod: 134,
        remoteJobs: 74,
        localJobs: 14,
        periodEnd: FIXED_NOW,
      });
    });

    it('marca o inicio do periodo sete dias antes da referencia', async () => {
      await setup.useCase.execute(FIXED_NOW);

      const esperado = new Date(FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000);

      expect(sentDigest(setup.notify).periodStart).toEqual(esperado);
    });

    it('leva so as cinco tecnologias mais pedidas, da maior para a menor', async () => {
      await setup.useCase.execute(FIXED_NOW);

      expect(TOP_TECHNOLOGIES).toBe(5);
      expect(sentDigest(setup.notify).topTechnologies).toEqual([
        { label: 'React', total: 61 },
        { label: 'Node.js', total: 44 },
        { label: 'TypeScript', total: 39 },
        { label: 'Angular', total: 21 },
        { label: '.NET', total: 18 },
      ]);
    });

    it('descarta tecnologia sem nenhuma vaga na semana', async () => {
      const comZeros = build({
        ...SNAPSHOT,
        technologies: [
          { id: 'React', label: 'React', total: 3 },
          { id: 'C#', label: 'C#', total: 0 },
        ],
      });

      await comZeros.useCase.execute(FIXED_NOW);

      expect(sentDigest(comZeros.notify).topTechnologies).toEqual([{ label: 'React', total: 3 }]);
    });

    it('ordena mesmo quando o repositorio devolve fora de ordem', async () => {
      const desordenado = build({
        ...SNAPSHOT,
        technologies: [
          { id: 'Angular', label: 'Angular', total: 4 },
          { id: 'React', label: 'React', total: 90 },
        ],
      });

      await desordenado.useCase.execute(FIXED_NOW);

      expect(sentDigest(desordenado.notify).topTechnologies[0]?.label).toBe('React');
    });

    it('devolve o resumo, para o comando de teste imprimir no terminal', async () => {
      const digest = await setup.useCase.execute(FIXED_NOW);

      expect(digest.openJobs).toBe(88);
      expect(digest).toEqual(sentDigest(setup.notify));
    });
  });

  describe('semana sem movimento', () => {
    it('envia o resumo mesmo zerado, para o canal nao ficar em silencio', async () => {
      const vazio = build({
        openJobs: 0,
        newInPeriod: 0,
        remoteJobs: 0,
        localJobs: 0,
        technologies: [],
      });

      await vazio.useCase.execute(FIXED_NOW);

      expect(vazio.notify).toHaveBeenCalledTimes(1);
      expect(sentDigest(vazio.notify).topTechnologies).toEqual([]);
    });
  });
});
