import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import {
  GetMarketInsightsUseCase,
  type MarketInsights,
} from '@/application/use-cases/get-market-insights.use-case';
import { MarketController } from '@/http/controllers/market.controller';

const INSIGHTS: MarketInsights = {
  windowInHours: 72,
  openJobs: 92,
  technologies: [{ id: 'react', label: 'React', total: 41, percentage: 44.6 }],
  seniorities: [{ id: 'SENIOR', label: 'Senior', total: 29, percentage: 31.5 }],
  workModels: [{ id: 'REMOTE', label: 'Remoto', total: 86, percentage: 93.5 }],
  scopes: [{ id: 'NATIONAL', label: 'Nacionais', total: 76, percentage: 82.6 }],
  seniorityNotInformed: {
    id: 'UNKNOWN',
    label: 'Nao informada',
    total: 56,
    percentage: 60.9,
  },
};

describe('Market (E2E)', () => {
  let app: INestApplication;
  let execute: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    execute = vi.fn().mockResolvedValue(INSIGHTS);

    const moduleRef = await Test.createTestingModule({
      controllers: [MarketController],
      providers: [{ provide: GetMarketInsightsUseCase, useValue: { execute } }],
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

  it('devolve os indicadores de mercado', async () => {
    const response = await http().get('/api/market').expect(200);

    expect(response.body).toEqual(INSIGHTS);
  });

  it('delega ao caso de uso, sem logica propria no controller', async () => {
    await http().get('/api/market');

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('entrega os quatro recortes que a aba Mercado consome', async () => {
    const response = await http().get('/api/market').expect(200);

    expect(response.body).toMatchObject({
      windowInHours: 72,
      technologies: expect.any(Array),
      seniorities: expect.any(Array),
      workModels: expect.any(Array),
      scopes: expect.any(Array),
    });
  });
});
