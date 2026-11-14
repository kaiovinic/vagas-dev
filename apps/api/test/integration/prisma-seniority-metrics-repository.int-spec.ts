import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GetSeniorityDistributionUseCase } from '@/application/use-cases/get-seniority-distribution.use-case';
import type { TitleSeniorityBucket } from '@/domain/repositories/seniority-metrics-repository';
import { brasiliaCalendarRange, type CalendarRange } from '@/domain/services/brasilia-calendar';
import {
  JOB_SENIORITY_LEVELS,
  keywordsAboveSeniority,
  seniorityKeywords,
} from '@/domain/services/job-seniority';
import { PrismaSeniorityMetricsRepository } from '@/infra/prisma/prisma-seniority-metrics-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaSeniorityMetricsRepository(prisma);
const useCase = new GetSeniorityDistributionUseCase(repository);

/** Dia 26/10/2026 em Brasilia: `[26T03:00Z, 27T03:00Z)`. */
const DIA_26 = brasiliaCalendarRange({ year: 2026, month: 10, day: 26 });
const DIA_25 = brasiliaCalendarRange({ year: 2026, month: 10, day: 25 });
const OUTUBRO = brasiliaCalendarRange({ year: 2026, month: 10, day: null });
const ANO_2026 = brasiliaCalendarRange({ year: 2026, month: null, day: null });

let sequence = 0;

/**
 * Grava uma vaga com `createdAt` explicito.
 *
 * Os outros testes de integracao semeiam pelo `saveMany`, mas ali o `createdAt`
 * cai no `now()` do banco — e e exatamente a coluna que este repositorio recorta.
 * Sem controlar o instante da captura nao ha como testar a borda do dia.
 */
async function captura(title: string, createdAt: Date, closedAt: Date | null = null): Promise<void> {
  sequence += 1;

  await prisma.job.create({
    data: {
      fingerprint: String(sequence).padStart(64, '0'),
      source: 'gupy',
      title,
      company: 'Acme Corp',
      url: `https://exemplo.test/vagas/${sequence}`,
      publishedAt: createdAt,
      createdAt,
      closedAt,
    },
  });
}

/** Os grupos reais do dominio, como o caso de uso os monta. */
function todosOsNiveis(): TitleSeniorityBucket[] {
  return JOB_SENIORITY_LEVELS.map((level) => ({
    id: level,
    keywords: seniorityKeywords(level),
    outranked: keywordsAboveSeniority(level),
  }));
}

async function contarPorNivel(range: CalendarRange): Promise<Record<string, number>> {
  const counts = await repository.countCapturedByTitleBucket(range, todosOsNiveis());

  // `as const` nao e enfeite: sem a tupla o `fromEntries` cai na sobrecarga
  // que devolve `any`, e o lint reprova.
  return Object.fromEntries(counts.map((count) => [count.id, count.total] as const));
}

beforeEach(async () => {
  sequence = 0;
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaSeniorityMetricsRepository (integracao)', () => {
  /**
   * O `mode: 'insensitive'` do Prisma vira `ILIKE` no Postgres, que dobra a
   * caixa e NAO dobra o acento. E a medicao da premissa do vocabulario: e por
   * isso que `senior` e `sênior` vao os dois explicitos, e nao por excesso de
   * zelo.
   */
  describe('acentuacao e caixa', () => {
    beforeEach(async () => {
      await captura('Desenvolvedor Front End Sênior', new Date('2026-10-26T12:00:00.000Z'));
      await captura('Senior Software Engineer', new Date('2026-10-26T12:00:00.000Z'));
      await captura('DESENVOLVEDOR .NET SENIOR', new Date('2026-10-26T12:00:00.000Z'));
      await captura('dev angular sênior', new Date('2026-10-26T12:00:00.000Z'));
      await captura('Desenvolvedor Front End SR', new Date('2026-10-26T12:00:00.000Z'));
    });

    it('classifica as cinco variantes de senior, com e sem acento, em qualquer caixa', async () => {
      const porNivel = await contarPorNivel(DIA_26);

      expect(porNivel.SENIOR).toBe(5);
    });

    it('ignora a caixa: um termo minusculo casa o titulo em maiusculas', async () => {
      const [semAcento] = await repository.countCapturedByTitleBucket(DIA_26, [
        { id: 'SENIOR', keywords: ['senior'], outranked: [] },
      ]);

      // 'Senior Software Engineer', 'DESENVOLVEDOR .NET SENIOR'.
      expect(semAcento?.total).toBe(2);
    });

    /** A assercao que justifica a variante acentuada existir no vocabulario. */
    it('NAO ignora o acento: "senior" nao alcanca "Sênior"', async () => {
      const [comAcento] = await repository.countCapturedByTitleBucket(DIA_26, [
        { id: 'SENIOR', keywords: ['sênior'], outranked: [] },
      ]);

      // 'Desenvolvedor Front End Sênior', 'dev angular sênior'.
      expect(comAcento?.total).toBe(2);
    });

    it('casa a abreviacao com espaco a esquerda, sem depender da caixa', async () => {
      const [abreviacao] = await repository.countCapturedByTitleBucket(DIA_26, [
        { id: 'SENIOR', keywords: [' sr'], outranked: [] },
      ]);

      expect(abreviacao?.total).toBe(1);
    });

    /**
     * Limite conhecido, nao defeito novo: o `contains` nao tem limite de
     * palavra, entao " SRE" casa com a abreviacao ` sr`. Fica registrado contra
     * o banco de verdade para que a troca por `~*` com `\y` tenha uma linha de
     * base para comparar.
     */
    it('conta "SRE" como senior, que e o limite conhecido do contains', async () => {
      await captura('Analista SRE Cloud', new Date('2026-10-26T12:00:00.000Z'));

      const porNivel = await contarPorNivel(DIA_26);

      expect(porNivel.SENIOR).toBe(6);
    });
  });

  /**
   * As bordas valem o teste porque a coluna e `timestamp` sem fuso e o recorte
   * nasce no calendario de Brasilia: meia-noite em Salvador e 03:00 UTC, e e o
   * deslocamento de 3h que decide em que dia a vaga cai.
   */
  describe('bordas do dia no horario de Brasilia', () => {
    beforeEach(async () => {
      // 23:59 do dia 25 em Brasilia.
      await captura('Desenvolvedor Pleno A', new Date('2026-10-26T02:59:00.000Z'));
      // 00:00 do dia 26 em Brasilia, no primeiro instante da janela.
      await captura('Desenvolvedor Pleno B', new Date('2026-10-26T03:00:00.000Z'));
      // 23:59 do dia 26 em Brasilia.
      await captura('Desenvolvedor Pleno C', new Date('2026-10-27T02:59:00.000Z'));
      // 00:00 do dia 27 em Brasilia, no primeiro instante de fora.
      await captura('Desenvolvedor Pleno D', new Date('2026-10-27T03:00:00.000Z'));
    });

    it('conta no dia 26 so o que foi capturado entre 00:00 e 23:59 de Brasilia', async () => {
      await expect(repository.countCapturedJobs(DIA_26)).resolves.toBe(2);
    });

    /** A vaga das 23:59 pertence ao dia que acaba, e nao ao que comeca. */
    it('devolve a vaga das 23:59 ao dia anterior, e nao ao seguinte', async () => {
      await expect(repository.countCapturedJobs(DIA_25)).resolves.toBe(1);
    });

    it('nao conta a mesma vaga em dois dias seguidos', async () => {
      const [vinteCinco, vinteSeis, vinteSete] = await Promise.all([
        repository.countCapturedJobs(DIA_25),
        repository.countCapturedJobs(DIA_26),
        repository.countCapturedJobs(brasiliaCalendarRange({ year: 2026, month: 10, day: 27 })),
      ]);

      expect(vinteCinco + vinteSeis + vinteSete).toBe(4);
    });

    it('recorta o nivel com a mesma borda da contagem total', async () => {
      const porNivel = await contarPorNivel(DIA_26);

      expect(porNivel.MID).toBe(2);
    });
  });

  describe('bordas do mes e do ano no horario de Brasilia', () => {
    it('mantem em outubro a vaga das 23:59 do dia 31', async () => {
      // 23:59 de 31/10 em Brasilia ja e 01/11 em UTC.
      await captura('Desenvolvedor Pleno Outubro', new Date('2026-11-01T02:59:00.000Z'));
      await captura('Desenvolvedor Pleno Novembro', new Date('2026-11-01T03:00:00.000Z'));

      await expect(repository.countCapturedJobs(OUTUBRO)).resolves.toBe(1);
      await expect(
        repository.countCapturedJobs(brasiliaCalendarRange({ year: 2026, month: 11, day: null })),
      ).resolves.toBe(1);
    });

    it('mantem em 2026 a vaga das 23:59 de 31 de dezembro', async () => {
      // 23:59 de 31/12/2026 em Brasilia ja e 01/01/2027 em UTC.
      await captura('Desenvolvedor Pleno Reveillon', new Date('2027-01-01T02:59:00.000Z'));
      await captura('Desenvolvedor Pleno Ano Novo', new Date('2027-01-01T03:00:00.000Z'));

      await expect(repository.countCapturedJobs(ANO_2026)).resolves.toBe(1);
      await expect(
        repository.countCapturedJobs(brasiliaCalendarRange({ year: 2027, month: null, day: null })),
      ).resolves.toBe(1);
    });
  });

  /**
   * O `NOT: { OR: [...] }` ao lado do `OR` principal e o que faz cada vaga
   * contar uma vez so. Sem ele a soma dos niveis passaria do total capturado, e
   * o grafico diria que o periodo trouxe mais vagas do que trouxe.
   */
  describe('exclusao dos niveis superiores', () => {
    beforeEach(async () => {
      await captura('Tech Lead Senior', new Date('2026-10-26T12:00:00.000Z'));
      await captura('Especialista React Sênior', new Date('2026-10-26T12:00:00.000Z'));
      await captura('Desenvolvedor Pleno/Senior', new Date('2026-10-26T12:00:00.000Z'));
      await captura('Desenvolvedor Front End Pleno', new Date('2026-10-26T12:00:00.000Z'));
    });

    it('conta "Tech Lead Senior" e "Especialista React Sênior" apenas em LEAD', async () => {
      const porNivel = await contarPorNivel(DIA_26);

      expect(porNivel.LEAD).toBe(2);
    });

    it('nao repete em SENIOR o titulo que ja entrou em LEAD', async () => {
      const porNivel = await contarPorNivel(DIA_26);

      // So 'Desenvolvedor Pleno/Senior' sobra como senior.
      expect(porNivel.SENIOR).toBe(1);
    });

    it('nao repete em MID o titulo que cita pleno e senior', async () => {
      const porNivel = await contarPorNivel(DIA_26);

      expect(porNivel.MID).toBe(1);
    });

    it('faz a soma dos niveis fechar com o total capturado', async () => {
      const porNivel = await contarPorNivel(DIA_26);
      const soma = Object.values(porNivel).reduce((total, atual) => total + atual, 0);

      await expect(repository.countCapturedJobs(DIA_26)).resolves.toBe(soma);
    });
  });

  describe('recorte da captura', () => {
    /**
     * Decisao de projeto, igual a da volumetria: o recorte e a captura, nao a
     * oferta. A vaga que a fonte encerrou depois continua tendo sido capturada
     * naquele dia, e tira-la reescreveria o passado do grafico.
     */
    it('conta a vaga encerrada na fonte, porque ela foi capturada no periodo', async () => {
      await captura(
        'Desenvolvedor Pleno Encerrado',
        new Date('2026-10-26T12:00:00.000Z'),
        new Date('2026-10-28T12:00:00.000Z'),
      );

      await expect(repository.countCapturedJobs(DIA_26)).resolves.toBe(1);
      expect((await contarPorNivel(DIA_26)).MID).toBe(1);
    });

    it('devolve zero e nenhum nivel quando o periodo nao capturou nada', async () => {
      await captura('Desenvolvedor Pleno', new Date('2026-10-26T12:00:00.000Z'));

      const vazio = brasiliaCalendarRange({ year: 2025, month: null, day: null });

      await expect(repository.countCapturedJobs(vazio)).resolves.toBe(0);
      expect(Object.values(await contarPorNivel(vazio)).every((total) => total === 0)).toBe(true);
    });
  });

  /** O caminho inteiro contra o Postgres: calendario, consulta e normalizacao. */
  describe('GetSeniorityDistributionUseCase sobre o banco real', () => {
    beforeEach(async () => {
      await captura('Estagio em Front-end', new Date('2026-10-26T12:00:00.000Z'));
      await captura('Dev Angular Jr', new Date('2026-10-26T12:00:00.000Z'));
      await captura('Desenvolvedor Front End Pleno', new Date('2026-10-26T12:00:00.000Z'));
      await captura('Desenvolvedor .NET Sênior', new Date('2026-10-26T12:00:00.000Z'));
      await captura('Tech Lead Senior', new Date('2026-10-26T12:00:00.000Z'));
      // Sem nivel no titulo: e o que sobra em "Nao especificado".
      await captura('Desenvolvedor Front End React', new Date('2026-10-26T12:00:00.000Z'));
      // Fora do recorte: 23:59 do dia anterior.
      await captura('Desenvolvedor Pleno Ontem', new Date('2026-10-26T02:59:00.000Z'));
    });

    it('distribui os seis niveis na ordem logica', async () => {
      const distribuicao = await useCase.execute({ year: 2026, month: 10, day: 26 });

      expect(distribuicao.levels).toEqual([
        { id: 'INTERN', label: 'Estagio', total: 1, percentage: 16.7 },
        { id: 'JUNIOR', label: 'Junior', total: 1, percentage: 16.7 },
        { id: 'MID', label: 'Pleno', total: 1, percentage: 16.7 },
        { id: 'SENIOR', label: 'Senior', total: 1, percentage: 16.7 },
        { id: 'LEAD', label: 'Lead/Especialista', total: 1, percentage: 16.7 },
        { id: 'UNSPECIFIED', label: 'Nao especificado', total: 1, percentage: 16.7 },
      ]);
    });

    it('deixa de fora a vaga capturada na borda do dia anterior', async () => {
      const distribuicao = await useCase.execute({ year: 2026, month: 10, day: 26 });

      expect(distribuicao.total).toBe(6);
    });

    it('filtra os niveis exibidos sem mexer no total do periodo', async () => {
      const distribuicao = await useCase.execute({
        year: 2026,
        month: 10,
        day: 26,
        seniorities: ['LEAD', 'UNSPECIFIED'],
      });

      expect(distribuicao.levels.map((level) => level.id)).toEqual(['LEAD', 'UNSPECIFIED']);
      expect(distribuicao.filteredTotal).toBe(2);
      expect(distribuicao.total).toBe(6);
    });

    it('alarga o recorte para o mes e alcanca as duas capturas', async () => {
      const distribuicao = await useCase.execute({ year: 2026, month: 10 });

      expect(distribuicao.total).toBe(7);
      expect(distribuicao.levels[2]).toEqual({
        id: 'MID',
        label: 'Pleno',
        total: 2,
        percentage: 28.6,
      });
    });
  });
});
