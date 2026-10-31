import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobRuleEngine } from '@/domain/services/job-rule-engine';
import {
  RunJobCollectionUseCase,
} from '@/application/use-cases/run-job-collection.use-case';
import {
  FakeCaptureSchedule,
  FakeTelegramNotifier,
  InMemoryCaptureLogRepository,
  InMemoryJobWriteRepository,
  StubScraperProvider,
  rawJob,
  InMemorySourceHealthWriter,
} from '../../../test/factories/doubles';
import { FIXED_NOW, hoursAgo } from '../../../test/factories/make-job';

describe('RunJobCollectionUseCase', () => {
  let jobs: InMemoryJobWriteRepository;
  let captureLogs: InMemoryCaptureLogRepository;
  let notifier: FakeTelegramNotifier;
  let schedule: FakeCaptureSchedule;
  let sourceHealth: InMemorySourceHealthWriter;

  beforeEach(() => {
    jobs = new InMemoryJobWriteRepository();
    captureLogs = new InMemoryCaptureLogRepository();
    notifier = new FakeTelegramNotifier();
    schedule = new FakeCaptureSchedule();
    sourceHealth = new InMemorySourceHealthWriter();
  });

  function buildUseCase(scrapers: StubScraperProvider[]): RunJobCollectionUseCase {
    return new RunJobCollectionUseCase(
      scrapers,
      new JobRuleEngine(),
      jobs,
      captureLogs,
      notifier,
      schedule,
      sourceHealth,
    );
  }

  describe('execucao das fontes', () => {
    it('executa todos os coletores registrados', async () => {
      const gupy = new StubScraperProvider('gupy', [rawJob()]);
      const remotar = new StubScraperProvider('remotar', [
        rawJob({ source: 'remotar', company: 'Globex', url: 'https://remotar.com.br/vaga/2' }),
      ]);

      await buildUseCase([gupy, remotar]).execute(FIXED_NOW);

      expect(gupy.calls).toBe(1);
      expect(remotar.calls).toBe(1);
      expect(jobs.saved).toHaveLength(2);
    });

    it('nao interrompe as demais fontes quando uma falha', async () => {
      const failing = new StubScraperProvider('linkedin', new Error('403 Forbidden'));
      const working = new StubScraperProvider('gupy', [rawJob()]);

      const report = await buildUseCase([failing, working]).execute(FIXED_NOW);

      expect(report.failedSources).toEqual(['linkedin']);
      expect(report.status).toBe('PARTIAL');
      expect(jobs.saved).toHaveLength(1);
    });

    it('marca a captura como FAILED quando todas as fontes falham', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('gupy', new Error('timeout')),
        new StubScraperProvider('remotar', new Error('500')),
      ]).execute(FIXED_NOW);

      expect(report.status).toBe('FAILED');
      expect(report.failedSources).toEqual(['gupy', 'remotar']);
      expect(report.errorMessage).toContain('2');
    });

    it('registra a falha de uma fonte que rejeita sem um Error', async () => {
      const rogue: StubScraperProvider = {
        source: 'fonte-fora-do-contrato',
        label: 'Fonte fora do contrato',
        calls: 0,
        scrape: async () => Promise.reject('falha crua'),
      } as unknown as StubScraperProvider;

      const report = await buildUseCase([rogue, new StubScraperProvider('gupy', [rawJob()])]).execute(
        FIXED_NOW,
      );

      expect(report.status).toBe('PARTIAL');
      expect(report.failedSources).toEqual(['fonte-fora-do-contrato']);
      expect(jobs.saved).toHaveLength(1);
    });

    it('conclui com SUCCESS quando nenhuma fonte falha', async () => {
      const report = await buildUseCase([new StubScraperProvider('gupy', [rawJob()])]).execute(
        FIXED_NOW,
      );

      expect(report.status).toBe('SUCCESS');
      expect(report.errorMessage).toBeUndefined();
    });

    it('conclui com SUCCESS quando nao ha coletor registrado', async () => {
      const report = await buildUseCase([]).execute(FIXED_NOW);

      expect(report.status).toBe('SUCCESS');
      expect(report.totalFound).toBe(0);
    });
  });

  describe('filtragem pelo JobRuleEngine', () => {
    it('descarta vagas fora da janela de 72 horas', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('gupy', [rawJob({ publishedAt: hoursAgo(100) })]),
      ]).execute(FIXED_NOW);

      expect(report.totalFound).toBe(1);
      expect(report.totalApproved).toBe(0);
      expect(report.totalRejected).toBe(1);
      expect(jobs.saved).toHaveLength(0);
    });

    it('descarta publicacoes de spam', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('github', [rawJob({ title: 'Bootcamp Fullstack gratuito' })]),
      ]).execute(FIXED_NOW);

      expect(report.totalApproved).toBe(0);
    });

    it('descarta vagas fora da stack e fora da area', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('gupy', [
          rawJob({
            title: 'Analista de Suporte',
            description: 'Atendimento ao cliente',
            location: 'Sao Paulo/SP',
            workModel: 'ONSITE',
          }),
        ]),
      ]).execute(FIXED_NOW);

      expect(report.totalApproved).toBe(0);
    });

    it('descarta vagas que nao formam uma entidade valida', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('gupy', [
          rawJob({ company: '   ' }),
          rawJob({ url: 'nao-e-url', company: 'Globex' }),
        ]),
      ]).execute(FIXED_NOW);

      expect(report.totalFound).toBe(2);
      expect(report.totalApproved).toBe(0);
      expect(report.totalRejected).toBe(2);
    });

    it('descarta a vaga internacional e grava o mercado das demais', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('remotar', [
          rawJob({ tags: ['✈️ Vaga internacional'], url: 'https://remotar.com.br/vaga/1' }),
          rawJob({
            company: 'Globex',
            tags: ['💼 CLT'],
            url: 'https://remotar.com.br/vaga/2',
          }),
          // Titulo em ingles e sem localidade: o unico jeito de a vaga ficar
          // sem mercado identificado depois da calibracao, que trata cargo em
          // portugues como sinal brasileiro.
          rawJob({
            company: 'Initech',
            title: 'React Engineer',
            description: 'Remote role',
            location: 'Remoto',
            url: 'https://remotar.com.br/vaga/3',
          }),
        ]),
      ]).execute(FIXED_NOW);

      // O radar cobre so o mercado brasileiro: a primeira nao chega ao banco.
      expect(jobs.saved.map((entry) => entry.scope)).toEqual(['NATIONAL', 'UNKNOWN']);
      expect(report.totalApproved).toBe(2);
      expect(report.totalRejected).toBe(1);
    });

    it('repassa a origem declarada pelo coletor ao motor de regras', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('linkedin-posts', [
          // Publicacao social sem marcador de anuncio: so passa se a origem
          // NAO chegar ao motor, que e justamente o que este caso protege.
          rawJob({
            // "trabalho remoto", nao "vaga remota": o segundo e cabecalho de
            // anuncio e salvaria o post da regra que este caso exercita.
            title: 'O mercado de React no Brasil',
            description: 'Reflexao sobre a stack. Trabalho remoto, CLT.',
            origin: 'SOCIAL_POST',
            url: 'https://www.linkedin.com/posts/acme_react-share-7521262024920764416-91vX',
          }),
        ]),
      ]).execute(FIXED_NOW);

      expect(report.totalApproved).toBe(0);
      expect(report.totalRejected).toBe(1);
    });

    it('aprova a mesma publicacao quando ela anuncia a vaga', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('linkedin-posts', [
          rawJob({
            title: 'Estamos contratando pessoa desenvolvedora React',
            description: 'Vaga remota CLT.',
            origin: 'SOCIAL_POST',
            url: 'https://www.linkedin.com/posts/acme_react-share-7521262024920764416-91vX',
          }),
        ]),
      ]).execute(FIXED_NOW);

      expect(report.totalApproved).toBe(1);
    });

    it('reprova pela tag da fonte, que nem aparece no titulo ou na descricao', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('remotar', [
          rawJob({ tags: ['✈️ Vaga internacional'], url: 'https://remotar.com.br/vaga/9' }),
        ]),
      ]).execute(FIXED_NOW);

      expect(report.totalApproved).toBe(0);
      expect(jobs.saved).toEqual([]);
    });

    it('aprova vaga remota de qualquer cidade', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('remotar', [
          rawJob({ location: 'Curitiba/PR', workModel: 'REMOTE' }),
        ]),
      ]).execute(FIXED_NOW);

      expect(report.totalApproved).toBe(1);
    });
  });

  describe('data de publicacao estimada', () => {
    it('assume o instante da captura quando a fonte nao informa data', async () => {
      await buildUseCase([
        new StubScraperProvider('programathor', [
          { ...rawJob(), publishedAt: undefined, publishedAtSource: 'CAPTURE' },
        ]),
      ]).execute(FIXED_NOW);

      expect(jobs.saved[0]?.job.publishedAt).toEqual(FIXED_NOW);
      expect(jobs.saved[0]?.publishedAtSource).toBe('CAPTURE');
    });

    it('assume valores vazios quando a fonte omite descricao, local e modalidade', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('github', [
          {
            title: 'Dev Frontend React',
            company: 'Acme Corp',
            source: 'github',
            url: 'https://github.com/frontendbr/vagas/issues/1',
            publishedAt: hoursAgo(1),
            publishedAtSource: 'SOURCE',
          },
        ]),
      ]).execute(FIXED_NOW);

      // Sem localidade nem modalidade a vaga nao passa pela regra de local.
      expect(report.totalFound).toBe(1);
      expect(report.totalApproved).toBe(0);
    });

    it('preserva a data informada pela fonte', async () => {
      const publishedAt = hoursAgo(10);

      await buildUseCase([new StubScraperProvider('gupy', [rawJob({ publishedAt })])]).execute(
        FIXED_NOW,
      );

      expect(jobs.saved[0]?.job.publishedAt).toEqual(publishedAt);
      expect(jobs.saved[0]?.publishedAtSource).toBe('SOURCE');
    });
  });

  describe('deduplicacao por fingerprint', () => {
    it('salva apenas uma vez a mesma vaga vinda de fontes diferentes', async () => {
      const report = await buildUseCase([
        new StubScraperProvider('gupy', [rawJob()]),
        new StubScraperProvider('linkedin', [
          rawJob({ source: 'linkedin', url: 'https://linkedin.com/jobs/9' }),
        ]),
      ]).execute(FIXED_NOW);

      expect(report.totalApproved).toBe(2);
      expect(report.totalDuplicated).toBe(1);
      expect(report.totalPersisted).toBe(1);
      expect(jobs.saved).toHaveLength(1);
    });

    it('nao reenvia vagas que o banco ja conhece', async () => {
      await buildUseCase([new StubScraperProvider('gupy', [rawJob()])]).execute(FIXED_NOW);
      notifier.notified.length = 0;

      const report = await buildUseCase([new StubScraperProvider('gupy', [rawJob()])]).execute(
        FIXED_NOW,
      );

      expect(report.totalPersisted).toBe(0);
      expect(report.totalDuplicated).toBe(1);
      expect(notifier.notified).toHaveLength(0);
      expect(jobs.saveCalls[1]).toEqual([]);
    });
  });

  describe('notificacao no Telegram', () => {
    it('notifica cada vaga inedita', async () => {
      await buildUseCase([
        new StubScraperProvider('gupy', [
          rawJob(),
          rawJob({ company: 'Globex', url: 'https://gupy.io/vagas/2' }),
        ]),
      ]).execute(FIXED_NOW);

      expect(notifier.notified.map((alerta) => alerta.job.company)).toEqual([
        'Acme Corp',
        'Globex',
      ]);
    });

    it('conclui a captura mesmo com o Telegram fora do ar', async () => {
      notifier.shouldFail = true;

      const report = await buildUseCase([
        new StubScraperProvider('gupy', [rawJob()]),
      ]).execute(FIXED_NOW);

      expect(report.status).toBe('SUCCESS');
      expect(report.totalPersisted).toBe(1);
      expect(jobs.saved).toHaveLength(1);
    });
  });

  describe('registro no CaptureLog', () => {
    it('abre o log com o horario de inicio e a previsao da proxima captura', async () => {
      await buildUseCase([new StubScraperProvider('gupy', [rawJob()])]).execute(FIXED_NOW);

      expect(captureLogs.started[0]).toEqual({
        startedAt: FIXED_NOW,
        nextRunAt: schedule.nextRunAt(FIXED_NOW),
      });
    });

    it('pergunta ao agendamento qual e o proximo disparo', async () => {
      const espiao = vi.spyOn(schedule, 'nextRunAt');

      await buildUseCase([]).execute(FIXED_NOW);

      // Nao e "agora + 2h": quem sabe a hora certa e o cron.
      expect(espiao).toHaveBeenCalledWith(FIXED_NOW);
    });

    it('fecha o log com os totais da execucao', async () => {
      await buildUseCase([
        new StubScraperProvider('gupy', [
          rawJob(),
          rawJob({ publishedAt: hoursAgo(200), company: 'Velha Corp' }),
        ]),
        new StubScraperProvider('linkedin', new Error('403')),
      ]).execute(FIXED_NOW);

      expect(captureLogs.finished[0]).toMatchObject({
        captureId: 'capture-1',
        status: 'PARTIAL',
        totalFound: 2,
        totalApproved: 1,
        totalRejected: 1,
        totalDuplicated: 0,
        totalPersisted: 1,
        failedSources: ['linkedin'],
      });
      expect(captureLogs.finished[0]?.finishedAt).toBeInstanceOf(Date);
    });

    it('devolve o identificador da captura no relatorio', async () => {
      const report = await buildUseCase([]).execute(FIXED_NOW);

      expect(report.captureId).toBe('capture-1');
      expect(report.startedAt).toEqual(FIXED_NOW);
      expect(report.nextRunAt).toEqual(schedule.nextRunAt(FIXED_NOW));
    });

    it('usa o horario atual quando nenhuma referencia e informada', async () => {
      const before = Date.now();

      const report = await buildUseCase([]).execute();

      expect(report.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});
