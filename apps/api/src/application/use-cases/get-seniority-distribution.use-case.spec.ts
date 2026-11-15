import { beforeEach, describe, expect, it } from 'vitest';

import {
  GetSeniorityDistributionUseCase,
  SENIORITY_FILTER_VALUES,
  UNSPECIFIED_SENIORITY,
} from '@/application/use-cases/get-seniority-distribution.use-case';
import { JOB_SENIORITY_LEVELS } from '@/domain/services/job-seniority';
import { StubSeniorityMetricsRepository } from '../../../test/factories/doubles';

const FIXED_NOW = new Date('2026-10-26T12:00:00.000Z');

describe('GetSeniorityDistributionUseCase', () => {
  let metrics: StubSeniorityMetricsRepository;
  let useCase: GetSeniorityDistributionUseCase;

  beforeEach(() => {
    metrics = new StubSeniorityMetricsRepository();
    useCase = new GetSeniorityDistributionUseCase(metrics);
  });

  describe('recorte de calendario', () => {
    it('usa o ano corrente de Brasilia quando nada e informado', async () => {
      const distribution = await useCase.execute({}, FIXED_NOW);

      expect(distribution.year).toBe(2026);
      expect(distribution.month).toBeNull();
      expect(distribution.day).toBeNull();
      expect(distribution.start.toISOString()).toBe('2026-01-01T03:00:00.000Z');
      expect(distribution.end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
    });

    it('fecha o intervalo no mes escolhido', async () => {
      const distribution = await useCase.execute({ year: 2026, month: 3 }, FIXED_NOW);

      expect(distribution.month).toBe(3);
      expect(metrics.lastRange?.start.toISOString()).toBe('2026-03-01T03:00:00.000Z');
      expect(metrics.lastRange?.end.toISOString()).toBe('2026-04-01T03:00:00.000Z');
    });

    it('fecha o intervalo no dia escolhido, nas 24h de Brasilia', async () => {
      const distribution = await useCase.execute({ year: 2026, month: 10, day: 26 }, FIXED_NOW);

      expect(distribution.day).toBe(26);
      expect(metrics.lastRange?.start.toISOString()).toBe('2026-10-26T03:00:00.000Z');
      expect(metrics.lastRange?.end.toISOString()).toBe('2026-10-27T03:00:00.000Z');
    });

    it('declara o fuso usado, para a legenda do grafico nao adivinhar', async () => {
      const distribution = await useCase.execute({}, FIXED_NOW);

      expect(distribution.timeZone).toBe('America/Bahia');
    });
  });

  describe('distribuicao', () => {
    beforeEach(() => {
      metrics.capturedTotal = 100;
      metrics.totalsByLevel = { INTERN: 5, JUNIOR: 15, MID: 30, SENIOR: 20, LEAD: 10 };
    });

    it('entrega os niveis na ordem logica, do estagio ao nao especificado', async () => {
      const distribution = await useCase.execute({}, FIXED_NOW);

      expect(distribution.levels.map((level) => level.id)).toEqual([
        ...JOB_SENIORITY_LEVELS,
        UNSPECIFIED_SENIORITY,
      ]);
    });

    it('rotula cada nivel com o nome do dominio', async () => {
      const distribution = await useCase.execute({}, FIXED_NOW);

      expect(distribution.levels.map((level) => level.label)).toEqual([
        'Estagio',
        'Junior',
        'Pleno',
        'Senior',
        'Lead/Especialista',
        'Nao especificado',
      ]);
    });

    /** O que sobra do total capturado e o que o titulo nao disse. */
    it('normaliza como "nao especificado" o que nenhum nivel classificou', async () => {
      const distribution = await useCase.execute({}, FIXED_NOW);
      const unspecified = distribution.levels.at(-1);

      expect(unspecified).toEqual({
        id: UNSPECIFIED_SENIORITY,
        label: 'Nao especificado',
        total: 20,
        percentage: 20,
      });
    });

    it('nunca devolve "nao especificado" negativo', async () => {
      metrics.capturedTotal = 10;

      const distribution = await useCase.execute({}, FIXED_NOW);

      expect(distribution.levels.at(-1)?.total).toBe(0);
    });

    it('calcula o percentual sobre o total capturado no periodo', async () => {
      const distribution = await useCase.execute({}, FIXED_NOW);

      expect(distribution.levels[2]).toEqual({
        id: 'MID',
        label: 'Pleno',
        total: 30,
        percentage: 30,
      });
    });

    it('devolve zeros quando o periodo nao capturou nada', async () => {
      metrics.capturedTotal = 0;
      metrics.totalsByLevel = {};

      const distribution = await useCase.execute({}, FIXED_NOW);

      expect(distribution.total).toBe(0);
      expect(distribution.levels.every((level) => level.total === 0)).toBe(true);
      expect(distribution.levels.every((level) => level.percentage === 0)).toBe(true);
    });

    /** Nivel que o repositorio nao devolveu e zero, e nao buraco no grafico. */
    it('mostra como zero o nivel ausente na resposta do repositorio', async () => {
      metrics.levelsToOmit = ['INTERN', 'LEAD'];

      const distribution = await useCase.execute({}, FIXED_NOW);

      expect(distribution.levels.map((level) => level.total)).toEqual([0, 15, 30, 20, 0, 35]);
    });

    /**
     * O nivel mais alto ganha: sem a exclusao, "Tech Lead Senior" entraria nas
     * duas barras e a soma passaria do total capturado.
     */
    it('manda os termos dos niveis superiores como exclusao de cada grupo', async () => {
      await useCase.execute({}, FIXED_NOW);

      const mid = metrics.lastBuckets.find((bucket) => bucket.id === 'MID');
      const lead = metrics.lastBuckets.find((bucket) => bucket.id === 'LEAD');

      expect(mid?.keywords).toContain('pleno');
      expect(mid?.outranked).toContain('senior');
      expect(mid?.outranked).toContain('lead');
      expect(lead?.outranked).toEqual([]);
    });
  });

  describe('filtro de senioridade', () => {
    beforeEach(() => {
      metrics.capturedTotal = 100;
      metrics.totalsByLevel = { INTERN: 5, JUNIOR: 15, MID: 30, SENIOR: 20, LEAD: 10 };
    });

    it('devolve apenas os niveis escolhidos', async () => {
      const distribution = await useCase.execute({ seniorities: ['MID', 'SENIOR'] }, FIXED_NOW);

      expect(distribution.levels.map((level) => level.id)).toEqual(['MID', 'SENIOR']);
    });

    it('aceita "nao especificado" como escolha do filtro', async () => {
      const distribution = await useCase.execute(
        { seniorities: [UNSPECIFIED_SENIORITY] },
        FIXED_NOW,
      );

      expect(distribution.levels.map((level) => level.id)).toEqual([UNSPECIFIED_SENIORITY]);
    });

    it('soma em `filteredTotal` so o que ficou visivel, sem mexer no total', async () => {
      const distribution = await useCase.execute({ seniorities: ['MID', 'SENIOR'] }, FIXED_NOW);

      expect(distribution.filteredTotal).toBe(50);
      expect(distribution.total).toBe(100);
    });

    it('mantem o percentual sobre o periodo inteiro, nao sobre o filtro', async () => {
      const distribution = await useCase.execute({ seniorities: ['MID'] }, FIXED_NOW);

      expect(distribution.levels[0]?.percentage).toBe(30);
    });

    it('devolve todos os niveis quando o filtro vem vazio', async () => {
      const distribution = await useCase.execute({ seniorities: [] }, FIXED_NOW);

      expect(distribution.levels).toHaveLength(SENIORITY_FILTER_VALUES.length);
    });

    it('ignora nivel desconhecido no filtro', async () => {
      const distribution = await useCase.execute({ seniorities: ['ARQUITETO', 'MID'] }, FIXED_NOW);

      expect(distribution.levels.map((level) => level.id)).toEqual(['MID']);
    });

    it('usa o horario atual quando nenhuma referencia e informada', async () => {
      await expect(useCase.execute()).resolves.toMatchObject({ timeZone: 'America/Bahia' });
    });
  });
});
