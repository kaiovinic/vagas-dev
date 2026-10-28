import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GetMarketInsightsUseCase } from '@/application/use-cases/get-market-insights.use-case';
import type {
  BucketCount,
  IMarketInsightsRepository,
  KeywordBucket,
  ScopeCount,
  WorkModelCount,
} from '@/domain/repositories/market-insights-repository';
import { FIXED_NOW } from '../../../test/factories/make-job';

class StubMarketRepository implements IMarketInsightsRepository {
  openJobs = 0;
  workModels: WorkModelCount[] = [];
  scopes: ScopeCount[] = [];
  bucketTotals: Readonly<Record<string, number>> = {};
  readonly receivedBuckets: KeywordBucket[][] = [];

  async countOpenJobs(): Promise<number> {
    return this.openJobs;
  }

  async countByWorkModel(): Promise<WorkModelCount[]> {
    return this.workModels;
  }

  async countByScope(): Promise<ScopeCount[]> {
    return this.scopes;
  }

  async countByKeywordBuckets(
    _reference: Date,
    buckets: readonly KeywordBucket[],
  ): Promise<BucketCount[]> {
    this.receivedBuckets.push([...buckets]);

    return buckets.map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      total: this.bucketTotals[bucket.id] ?? 0,
    }));
  }
}

describe('GetMarketInsightsUseCase', () => {
  let market: StubMarketRepository;
  let useCase: GetMarketInsightsUseCase;

  beforeEach(() => {
    market = new StubMarketRepository();
    useCase = new GetMarketInsightsUseCase(market);
  });

  it('informa a janela de 72h e o total de vagas abertas', async () => {
    market.openJobs = 50;

    const insights = await useCase.execute(FIXED_NOW);

    expect(insights.windowInHours).toBe(72);
    expect(insights.openJobs).toBe(50);
  });

  it('pede as tecnologias do catalogo de regras, buscando em todo o texto', async () => {
    await useCase.execute(FIXED_NOW);

    const technologyBuckets = market.receivedBuckets[0] ?? [];

    expect(technologyBuckets.map((bucket) => bucket.label)).toEqual(
      expect.arrayContaining(['React', 'Next.js', 'TypeScript', 'Node.js', '.NET']),
    );
    expect(technologyBuckets.every((bucket) => bucket.scope === 'TEXT')).toBe(true);
  });

  it('pede a senioridade apenas no titulo', async () => {
    await useCase.execute(FIXED_NOW);

    const seniorityBuckets = market.receivedBuckets[1] ?? [];

    expect(seniorityBuckets.map((bucket) => bucket.id)).toEqual([
      'INTERN',
      'JUNIOR',
      'MID',
      'SENIOR',
    ]);
    expect(seniorityBuckets.every((bucket) => bucket.scope === 'TITLE')).toBe(true);
  });

  it('calcula o percentual sobre as vagas abertas e ordena da maior', async () => {
    market.openJobs = 50;
    market.bucketTotals = { React: 20, 'Node.js': 30, Angular: 5 };

    const insights = await useCase.execute(FIXED_NOW);

    expect(insights.technologies.slice(0, 3)).toEqual([
      { id: 'Node.js', label: 'Node.js', total: 30, percentage: 60 },
      { id: 'React', label: 'React', total: 20, percentage: 40 },
      { id: 'Angular', label: 'Angular', total: 5, percentage: 10 },
    ]);
  });

  it('omite as fatias zeradas', async () => {
    market.openJobs = 10;
    market.bucketTotals = { React: 4 };

    const insights = await useCase.execute(FIXED_NOW);

    expect(insights.technologies).toHaveLength(1);
  });

  it('divide entre mercado nacional e internacional', async () => {
    market.openJobs = 50;
    market.scopes = [
      { scope: 'NATIONAL', total: 27 },
      { scope: 'INTERNATIONAL', total: 19 },
      { scope: 'UNKNOWN', total: 4 },
    ];

    const insights = await useCase.execute(FIXED_NOW);

    expect(insights.scopes).toEqual([
      { id: 'NATIONAL', label: 'Nacionais', total: 27, percentage: 54 },
      { id: 'INTERNATIONAL', label: 'Internacionais', total: 19, percentage: 38 },
      { id: 'UNKNOWN', label: 'Nao identificado', total: 4, percentage: 8 },
    ]);
  });

  it('traduz as modalidades', async () => {
    market.openJobs = 10;
    market.workModels = [
      { workModel: 'REMOTE', total: 7 },
      { workModel: 'ONSITE', total: 2 },
      { workModel: 'HYBRID', total: 1 },
      { workModel: 'UNKNOWN', total: 0 },
    ];

    const insights = await useCase.execute(FIXED_NOW);

    expect(insights.workModels).toEqual([
      { id: 'REMOTE', label: 'Remoto', total: 7, percentage: 70 },
      { id: 'ONSITE', label: 'Presencial', total: 2, percentage: 20 },
      { id: 'HYBRID', label: 'Hibrido', total: 1, percentage: 10 },
    ]);
  });

  it('calcula quantas vagas nao declaram nivel no titulo', async () => {
    market.openJobs = 50;
    market.bucketTotals = { SENIOR: 27, MID: 4, JUNIOR: 3 };

    const insights = await useCase.execute(FIXED_NOW);

    expect(insights.seniorityNotInformed).toEqual({
      id: 'UNKNOWN',
      label: 'Nao informado',
      total: 16,
      percentage: 32,
    });
  });

  it('nao deixa o restante negativo quando um titulo declara dois niveis', async () => {
    market.openJobs = 5;
    market.bucketTotals = { SENIOR: 4, MID: 4 };

    const insights = await useCase.execute(FIXED_NOW);

    expect(insights.seniorityNotInformed.total).toBe(0);
  });

  it('devolve tudo zerado quando nao ha vagas', async () => {
    const insights = await useCase.execute(FIXED_NOW);

    expect(insights.openJobs).toBe(0);
    expect(insights.technologies).toEqual([]);
    expect(insights.seniorities).toEqual([]);
    expect(insights.workModels).toEqual([]);
    expect(insights.scopes).toEqual([]);
    expect(insights.seniorityNotInformed.percentage).toBe(0);
  });

  it('usa o horario atual quando nenhuma referencia e informada', async () => {
    const spy = vi.spyOn(market, 'countOpenJobs');

    await useCase.execute();

    expect(spy).toHaveBeenCalled();
  });
});
