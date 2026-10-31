import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PersistableJob } from '@/domain/repositories/job-write-repository';
import { PrismaJobDescriptionRepository } from '@/infra/prisma/prisma-job-description-repository';
import { PrismaJobRepository } from '@/infra/prisma/prisma-job-repository';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { createTestPrisma, resetDatabase } from './database';
import { makeJob } from '../factories/make-job';

const prisma: PrismaService = createTestPrisma();
const repository = new PrismaJobDescriptionRepository(prisma);
const writer = new PrismaJobRepository(prisma);

const COM_DESCRICAO = 'https://br.linkedin.com/jobs/view/com-descricao-1';
const SEM_DESCRICAO = 'https://br.linkedin.com/jobs/view/sem-descricao-2';
const NUNCA_VISTA = 'https://br.linkedin.com/jobs/view/nunca-vista-3';

function entry(overrides: Partial<PersistableJob> = {}): PersistableJob {
  return {
    job: makeJob(),
    publishedAtSource: 'SOURCE',
    recruiterName: '',
    tags: [],
    scope: 'UNKNOWN',
    ...overrides,
  };
}

describe('PrismaJobDescriptionRepository (integracao)', () => {
  beforeEach(async () => {
    await resetDatabase(prisma);
    await writer.saveMany([
      entry({
        job: makeJob({
          title: 'Dev React com descricao',
          company: 'Acme',
          source: 'linkedin',
          url: COM_DESCRICAO,
          description: 'Vaga React em Feira de Santana.',
        }),
      }),
      entry({
        job: makeJob({
          title: 'Dev React sem descricao',
          company: 'Contoso',
          source: 'linkedin',
          url: SEM_DESCRICAO,
          description: '',
        }),
      }),
    ]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('devolve a descricao das vagas que ja a tem', async () => {
    const found = await repository.findDescriptionsByUrl([COM_DESCRICAO]);

    expect(found.get(COM_DESCRICAO)).toBe('Vaga React em Feira de Santana.');
  });

  it('nao devolve vaga gravada com descricao vazia', async () => {
    // Esta e a vaga capturada antes de a busca de detalhe existir: ela precisa
    // aparecer como desconhecida para o coletor busca-la uma vez.
    const found = await repository.findDescriptionsByUrl([SEM_DESCRICAO]);

    expect(found.has(SEM_DESCRICAO)).toBe(false);
  });

  it('ignora url que nunca foi vista', async () => {
    const found = await repository.findDescriptionsByUrl([NUNCA_VISTA]);

    expect(found.size).toBe(0);
  });

  it('responde a uma consulta com varias urls de uma vez', async () => {
    const found = await repository.findDescriptionsByUrl([
      COM_DESCRICAO,
      SEM_DESCRICAO,
      NUNCA_VISTA,
    ]);

    expect([...found.keys()]).toEqual([COM_DESCRICAO]);
  });

  it('nao consulta o banco com lista vazia', async () => {
    const found = await repository.findDescriptionsByUrl([]);

    expect(found.size).toBe(0);
  });
  describe('cache de descricao buscada', () => {
    const REPROVADA = 'https://br.linkedin.com/jobs/view/reprovada-pelas-regras-4';

    it('guarda a descricao de vaga que nunca sera gravada', async () => {
      // Card reprovado pelas regras: nao existe em `jobs`, mas custou uma
      // requisicao e nao pode custar outra no ciclo seguinte.
      await repository.saveDescriptions([
        { url: REPROVADA, description: 'Vaga presencial em Curitiba.' },
      ]);

      const found = await repository.findDescriptionsByUrl([REPROVADA]);

      expect(found.get(REPROVADA)).toBe('Vaga presencial em Curitiba.');
    });

    it('nao guarda descricao vazia, para a vaga ser tentada de novo', async () => {
      const gravadas = await repository.saveDescriptions([{ url: REPROVADA, description: '' }]);

      expect(gravadas).toBe(0);
      expect((await repository.findDescriptionsByUrl([REPROVADA])).size).toBe(0);
    });

    it('nao reclama quando a mesma url chega duas vezes', async () => {
      await repository.saveDescriptions([{ url: REPROVADA, description: 'primeira' }]);

      await expect(
        repository.saveDescriptions([{ url: REPROVADA, description: 'segunda' }]),
      ).resolves.toBe(0);
    });

    it('deduplica a url repetida dentro da mesma chamada', async () => {
      const gravadas = await repository.saveDescriptions([
        { url: REPROVADA, description: 'uma' },
        { url: REPROVADA, description: 'outra' },
      ]);

      expect(gravadas).toBe(1);
    });

    it('nao consulta o banco com lista vazia', async () => {
      await expect(repository.saveDescriptions([])).resolves.toBe(0);
    });

    it('acha a descricao tanto no cache quanto na vaga gravada', async () => {
      await repository.saveDescriptions([
        { url: REPROVADA, description: 'Vaga presencial em Curitiba.' },
      ]);

      const found = await repository.findDescriptionsByUrl([COM_DESCRICAO, REPROVADA]);

      expect([...found.keys()].sort()).toEqual([COM_DESCRICAO, REPROVADA].sort());
    });
  });
  describe('vagas gravadas sem descricao', () => {
    const OUTRA_FONTE = 'https://www.gupy.io/job/sem-descricao-5';

    it('devolve a url da vaga aberta que esta sem descricao', async () => {
      const urls = await repository.findUrlsMissingDescription('linkedin', 10);

      expect(urls).toEqual([SEM_DESCRICAO]);
    });

    it('nao devolve vaga de outra fonte', async () => {
      await writer.saveMany([
        entry({
          job: makeJob({
            title: 'Dev Node sem descricao',
            company: 'Gupy Co',
            source: 'gupy',
            url: OUTRA_FONTE,
            description: '',
          }),
        }),
      ]);

      expect(await repository.findUrlsMissingDescription('linkedin', 10)).toEqual([SEM_DESCRICAO]);
      expect(await repository.findUrlsMissingDescription('gupy', 10)).toEqual([OUTRA_FONTE]);
    });

    it('nao devolve vaga encerrada: consertar o texto dela nao muda nada', async () => {
      await prisma.job.updateMany({ where: { url: SEM_DESCRICAO }, data: { closedAt: new Date() } });

      expect(await repository.findUrlsMissingDescription('linkedin', 10)).toEqual([]);
    });

    it('respeita o limite e comeca pelas mais recentes', async () => {
      await writer.saveMany([
        entry({
          job: makeJob({
            title: 'Dev React recem publicada',
            company: 'Recente',
            source: 'linkedin',
            url: 'https://br.linkedin.com/jobs/view/recente-6',
            description: '',
            publishedAt: new Date(),
          }),
        }),
      ]);

      const urls = await repository.findUrlsMissingDescription('linkedin', 1);

      expect(urls).toEqual(['https://br.linkedin.com/jobs/view/recente-6']);
    });

    it('grava a descricao buscada pela url', async () => {
      const mudadas = await repository.fillDescriptionByUrl(SEM_DESCRICAO, 'Vaga Node remota.');

      expect(mudadas).toBe(1);
      expect(await repository.findDescriptionsByUrl([SEM_DESCRICAO])).toEqual(
        new Map([[SEM_DESCRICAO, 'Vaga Node remota.']]),
      );
    });

    it('nao sobrescreve a descricao de quem ja tem uma', async () => {
      const mudadas = await repository.fillDescriptionByUrl(COM_DESCRICAO, 'texto novo');

      expect(mudadas).toBe(0);
      expect((await repository.findDescriptionsByUrl([COM_DESCRICAO])).get(COM_DESCRICAO)).toBe(
        'Vaga React em Feira de Santana.',
      );
    });
  });
});
