import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

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
