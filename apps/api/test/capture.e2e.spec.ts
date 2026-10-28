import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { CaptureCoordinator } from '@/application/services/capture-coordinator.service';
import { RunJobCollectionUseCase } from '@/application/use-cases/run-job-collection.use-case';
import { CaptureController } from '@/http/controllers/capture.controller';
import { FIXED_NOW } from './factories/make-job';

const REPORT = {
  captureId: 'capture-1',
  startedAt: FIXED_NOW,
  finishedAt: new Date(FIXED_NOW.getTime() + 20_000),
  nextRunAt: new Date(FIXED_NOW.getTime() + 7_200_000),
  status: 'PARTIAL' as const,
  totalFound: 280,
  totalApproved: 52,
  totalRejected: 228,
  totalDuplicated: 34,
  totalPersisted: 18,
  failedSources: ['linkedin'],
};

describe('Capture (E2E)', () => {
  let app: INestApplication;
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    execute = vi.fn().mockResolvedValue(REPORT);

    const moduleRef = await Test.createTestingModule({
      controllers: [CaptureController],
      providers: [
        CaptureCoordinator,
        { provide: RunJobCollectionUseCase, useValue: { execute } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  function http(): request.Agent {
    return request(app.getHttpServer());
  }

  it('dispara a captura e devolve o relatorio', async () => {
    const response = await http().post('/api/capture/run').expect(200);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual({
      captureId: 'capture-1',
      status: 'PARTIAL',
      startedAt: FIXED_NOW.toISOString(),
      finishedAt: new Date(FIXED_NOW.getTime() + 20_000).toISOString(),
      nextRunAt: new Date(FIXED_NOW.getTime() + 7_200_000).toISOString(),
      totalFound: 280,
      totalApproved: 52,
      totalPersisted: 18,
      totalDuplicated: 34,
      failedSources: ['linkedin'],
      joinedRunning: false,
    });
  });

  it('responde 200, nao 201: nao cria recurso enderecavel', async () => {
    await http().post('/api/capture/run').expect(200);
  });

  /**
   * A trava de concorrencia e verificada no teste do `CaptureCoordinator`, onde da
   * para controlar o instante exato de cada chamada. Por HTTP nao ha como garantir
   * que as duas requisicoes estejam dentro do handler ao mesmo tempo sem deixar o
   * teste instavel; aqui so se afirma que a rota expoe o campo do contrato.
   */
  it('informa no contrato se apenas aguardou uma captura em andamento', async () => {
    const response = await http().post('/api/capture/run').expect(200);

    expect(response.body).toHaveProperty('joinedRunning', false);
  });

  it('permite nova captura depois que a anterior termina', async () => {
    await http().post('/api/capture/run').expect(200);
    await http().post('/api/capture/run').expect(200);

    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('devolve 500 quando a captura falha inteira', async () => {
    execute.mockRejectedValue(new Error('banco indisponivel'));

    await http().post('/api/capture/run').expect(500);
  });

  it('nao aceita GET na rota de captura', async () => {
    await http().get('/api/capture/run').expect(404);
  });
});
