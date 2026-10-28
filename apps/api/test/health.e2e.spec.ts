import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { HealthController } from '@/http/controllers/health.controller';
import { PrismaService } from '@/infra/prisma/prisma.service';

describe('Health (E2E)', () => {
  let app: INestApplication;
  let queryRaw: ReturnType<typeof vi.fn>;

  async function start(): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }

  beforeEach(() => {
    queryRaw = vi.fn().mockResolvedValue([{ ok: 1 }]);
  });

  afterEach(async () => {
    await app.close();
  });

  function http(): request.Agent {
    return request(app.getHttpServer());
  }

  it('responde 200 quando o banco responde', async () => {
    await start();

    const response = await http().get('/api/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('consulta o banco em vez de responder sempre ok', async () => {
    await start();

    await http().get('/api/health');

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('responde 503 quando o banco esta fora', async () => {
    queryRaw = vi.fn().mockRejectedValue(new Error('connection refused'));
    await start();

    const response = await http().get('/api/health').expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.database).toBe('down');
  });

  it('nao vaza detalhe interno da falha do banco', async () => {
    queryRaw = vi.fn().mockRejectedValue(new Error('password authentication failed for user'));
    await start();

    const response = await http().get('/api/health').expect(503);

    expect(JSON.stringify(response.body)).not.toContain('password');
  });
});
