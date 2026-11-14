import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { StubScraperProvider } from './factories/doubles';
import { createApiTestContext, type ApiTestContext } from './factories/make-api';

describe('Dashboard (E2E)', () => {
  let context: ApiTestContext;

  beforeEach(async () => {
    context = await createApiTestContext();
  });

  afterEach(async () => {
    await context.app.close();
  });

  function http(): request.Agent {
    return request(context.app.getHttpServer());
  }

  describe('GET /api/dashboard/summary', () => {
    it('devolve os quatro KPIs e o cabecalho de captura', async () => {
      context.metrics.summary = {
        openJobs: 40,
        newInLast24h: 12,
        newInPrevious24h: 9,
        remoteJobs: 30,
        hiringCompanies: 17,
      };
      const captureId = await context.captureLogs.start({
        startedAt: new Date('2026-10-26T12:00:00.000Z'),
        nextRunAt: new Date('2026-10-26T14:00:00.000Z'),
      });
      await context.captureLogs.finish({
        captureId,
        finishedAt: new Date('2026-10-26T12:00:30.000Z'),
        status: 'SUCCESS',
        totalFound: 50,
        totalApproved: 20,
        totalRejected: 30,
        totalDuplicated: 8,
        totalPersisted: 12,
        failedSources: [],
      });

      const response = await http().get('/api/dashboard/summary').expect(200);

      expect(response.body).toEqual({
        windowInHours: 72,
        capture: {
          lastCaptureAt: '2026-10-26T12:00:30.000Z',
          nextCaptureAt: '2026-10-26T14:00:00.000Z',
          status: 'SUCCESS',
          failedSources: [],
        },
        openJobs: { total: 40 },
        newInLast24h: { total: 12, previousTotal: 9, delta: 3 },
        remote: { total: 30, percentage: 75 },
        hiringCompanies: { total: 17 },
      });
    });

    it('devolve zeros e cabecalho nulo quando nunca houve captura', async () => {
      const response = await http().get('/api/dashboard/summary').expect(200);

      expect(response.body.capture).toEqual({
        lastCaptureAt: null,
        nextCaptureAt: null,
        status: null,
        failedSources: [],
      });
      expect(response.body.remote).toEqual({ total: 0, percentage: 0 });
    });
  });

  describe('GET /api/dashboard/sources-health', () => {
    it('devolve uma linha por fonte com status, intervalo e proxima execucao', async () => {
      context.sourceHealth.health = [
        {
          source: 'nextcommit',
          lastRunAt: new Date('2026-10-30T11:50:00.000Z'),
          ok: true,
          runsInWindow: 12,
          failuresInWindow: 0,
          totalFoundInWindow: 131,
        },
        {
          source: 'linkedin-posts',
          lastRunAt: new Date('2026-10-30T11:50:00.000Z'),
          ok: true,
          runsInWindow: 6,
          failuresInWindow: 0,
          totalFoundInWindow: 5,
        },
      ];

      const response = await http().get('/api/dashboard/sources-health').expect(200);

      expect(response.body.windowInHours).toBe(24);
      expect(response.body.sources).toEqual([
        {
          source: 'nextcommit',
          status: 'OK',
          lastRunAt: '2026-10-30T11:50:00.000Z',
          nextRunAt: '2026-10-30T13:50:00.000Z',
          intervalInHours: 2,
          runs: 12,
          failures: 0,
          totalFound: 131,
        },
        {
          source: 'linkedin-posts',
          status: 'OK',
          lastRunAt: '2026-10-30T11:50:00.000Z',
          nextRunAt: '2026-10-30T15:50:00.000Z',
          intervalInHours: 4,
          runs: 6,
          failures: 0,
          totalFound: 5,
        },
      ]);
    });

    it('devolve a lista vazia sem coletor registrado nem execucao', async () => {
      const response = await http().get('/api/dashboard/sources-health').expect(200);

      expect(response.body).toEqual({ windowInHours: 24, sources: [] });
    });

    /**
     * De ponta a ponta, o conserto do incidente: a fonte sem credencial chega
     * ao painel marcada, em vez de verde. Antes disto ela nao aparecia — sem
     * execucao nao havia linha no banco, e a tabela era feita do banco.
     */
    it('entrega a fonte sem credencial marcada, mesmo sem nunca ter rodado', async () => {
      const semChave = new StubScraperProvider('linkedin-posts', []);
      semChave.configured = false;
      context.scrapers.push(semChave);

      const response = await http().get('/api/dashboard/sources-health').expect(200);

      expect(response.body.sources).toEqual([
        {
          source: 'linkedin-posts',
          status: 'UNCONFIGURED',
          lastRunAt: null,
          nextRunAt: null,
          intervalInHours: 4,
          runs: 0,
          failures: 0,
          totalFound: 0,
        },
      ]);
    });

    it('marca como parada a fonte configurada que passou da hora', async () => {
      context.scrapers.push(new StubScraperProvider('gupy', []));
      context.sourceHealth.health = [
        {
          source: 'gupy',
          lastRunAt: new Date('2026-10-29T06:00:00.000Z'),
          ok: true,
          runsInWindow: 0,
          failuresInWindow: 0,
          totalFoundInWindow: 0,
        },
      ];

      const response = await http().get('/api/dashboard/sources-health').expect(200);

      expect(response.body.sources[0].status).toBe('INACTIVE');
    });
  });

  describe('GET /api/dashboard/seniority', () => {
    beforeEach(() => {
      context.seniority.capturedTotal = 100;
      context.seniority.totalsByLevel = {
        INTERN: 5,
        JUNIOR: 15,
        MID: 30,
        SENIOR: 20,
        LEAD: 10,
      };
    });

    it('devolve os niveis na ordem logica, com o nao especificado no fim', async () => {
      const response = await http().get('/api/dashboard/seniority?year=2026').expect(200);

      expect(response.body.levels).toEqual([
        { id: 'INTERN', label: 'Estagio', total: 5, percentage: 5 },
        { id: 'JUNIOR', label: 'Junior', total: 15, percentage: 15 },
        { id: 'MID', label: 'Pleno', total: 30, percentage: 30 },
        { id: 'SENIOR', label: 'Senior', total: 20, percentage: 20 },
        { id: 'LEAD', label: 'Lead/Especialista', total: 10, percentage: 10 },
        { id: 'UNSPECIFIED', label: 'Nao especificado', total: 20, percentage: 20 },
      ]);
    });

    it('recorta o ano inteiro no horario de Brasilia', async () => {
      const response = await http().get('/api/dashboard/seniority?year=2026').expect(200);

      expect(response.body.year).toBe(2026);
      expect(response.body.month).toBeNull();
      expect(response.body.day).toBeNull();
      expect(response.body.timeZone).toBe('America/Bahia');
      expect(response.body.start).toBe('2026-01-01T03:00:00.000Z');
      expect(response.body.end).toBe('2027-01-01T03:00:00.000Z');
    });

    it('usa o ano corrente quando o parametro nao e informado', async () => {
      const response = await http().get('/api/dashboard/seniority').expect(200);

      expect(response.body.year).toBe(new Date().getUTCFullYear());
    });

    it('recorta o mes escolhido', async () => {
      const response = await http()
        .get('/api/dashboard/seniority?year=2026&month=3')
        .expect(200);

      expect(response.body.month).toBe(3);
      expect(context.seniority.lastRange?.start.toISOString()).toBe('2026-03-01T03:00:00.000Z');
      expect(context.seniority.lastRange?.end.toISOString()).toBe('2026-04-01T03:00:00.000Z');
    });

    it('recorta as 24h do dia escolhido', async () => {
      const response = await http()
        .get('/api/dashboard/seniority?year=2026&month=10&day=26')
        .expect(200);

      expect(response.body.day).toBe(26);
      expect(context.seniority.lastRange?.start.toISOString()).toBe('2026-10-26T03:00:00.000Z');
      expect(context.seniority.lastRange?.end.toISOString()).toBe('2026-10-27T03:00:00.000Z');
    });

    it('filtra os niveis exibidos sem mexer no total do periodo', async () => {
      const response = await http()
        .get('/api/dashboard/seniority?year=2026&seniority=MID&seniority=SENIOR')
        .expect(200);

      expect(response.body.levels.map((level: { id: string }) => level.id)).toEqual([
        'MID',
        'SENIOR',
      ]);
      expect(response.body.filteredTotal).toBe(50);
      expect(response.body.total).toBe(100);
    });

    it('aceita um unico nivel no filtro', async () => {
      const response = await http()
        .get('/api/dashboard/seniority?year=2026&seniority=UNSPECIFIED')
        .expect(200);

      expect(response.body.levels).toEqual([
        { id: 'UNSPECIFIED', label: 'Nao especificado', total: 20, percentage: 20 },
      ]);
    });

    it.each([
      ['mes fora da faixa', 'year=2026&month=13', 'month'],
      ['dia fora da faixa', 'year=2026&month=1&day=40', 'day'],
      ['ano nao numerico', 'year=abc', 'year'],
      ['nivel inventado', 'year=2026&seniority=ARQUITETO', 'seniority'],
      ['dia sem mes', 'year=2026&day=10', 'day'],
      ['dia que o mes nao tem', 'year=2026&month=2&day=31', 'day'],
    ])('rejeita %s com 400', async (_label, query, path) => {
      const response = await http().get(`/api/dashboard/seniority?${query}`).expect(400);

      expect(response.body.message).toBe('Parametros invalidos');
      expect(response.body.issues[0].path).toBe(path);
    });
  });

  describe('GET /api/dashboard/charts', () => {
    beforeEach(() => {
      context.metrics.bySource = [
        { source: 'linkedin', total: 6 },
        { source: 'gupy', total: 4 },
      ];
      context.metrics.byDay = [
        { day: '2026-10-25', source: 'gupy', total: 3 },
        { day: '2026-10-25', source: 'linkedin', total: 1 },
        { day: '2026-10-26', source: 'gupy', total: 1 },
      ];
    });

    it('devolve o grafico de rosca com quantidade e percentual', async () => {
      const response = await http().get('/api/dashboard/charts?days=14').expect(200);

      expect(response.body.days).toBe(14);
      expect(response.body.openJobsBySource).toEqual([
        { source: 'linkedin', total: 6, percentage: 60 },
        { source: 'gupy', total: 4, percentage: 40 },
      ]);
    });

    it('devolve as barras empilhadas por dia e fonte', async () => {
      const response = await http().get('/api/dashboard/charts?days=14').expect(200);

      expect(response.body.sources).toEqual(['gupy', 'linkedin']);
      expect(response.body.newJobsByDay).toEqual([
        {
          day: '2026-10-25',
          total: 4,
          sources: [
            { source: 'gupy', total: 3, percentage: 75 },
            { source: 'linkedin', total: 1, percentage: 25 },
          ],
        },
        {
          day: '2026-10-26',
          total: 1,
          sources: [{ source: 'gupy', total: 1, percentage: 100 }],
        },
      ]);
    });

    it('devolve a volumetria de captura em blocos de 2 horas', async () => {
      context.metrics.timeline = [
        { start: new Date('2026-10-26T09:00:00.000Z'), label: '06:00', total: 5 },
        { start: new Date('2026-10-26T11:00:00.000Z'), label: '08:00', total: 0 },
      ];

      const response = await http().get('/api/dashboard/charts').expect(200);

      expect(response.body.captureBlockInHours).toBe(2);
      expect(response.body.capturesTimeline).toEqual([
        { label: '06:00', count: 5, start: '2026-10-26T09:00:00.000Z' },
        { label: '08:00', count: 0, start: '2026-10-26T11:00:00.000Z' },
      ]);
    });

    it('usa 14 dias quando o periodo nao e informado', async () => {
      const response = await http().get('/api/dashboard/charts').expect(200);

      expect(response.body.days).toBe(14);
      expect(context.metrics.lastDaysArgument).toBe(14);
    });

    it('aceita outro periodo', async () => {
      const response = await http().get('/api/dashboard/charts?days=7').expect(200);

      expect(response.body.days).toBe(7);
      expect(context.metrics.lastDaysArgument).toBe(7);
    });

    it.each([
      ['dias acima do maximo', 'days=500'],
      ['dias zerados', 'days=0'],
      ['dias nao numericos', 'days=abc'],
    ])('rejeita %s com 400', async (_label, query) => {
      const response = await http().get(`/api/dashboard/charts?${query}`).expect(400);

      expect(response.body.message).toBe('Parametros invalidos');
      expect(response.body.issues[0].path).toBe('days');
    });
  });
});
