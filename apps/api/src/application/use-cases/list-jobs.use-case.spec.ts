import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_PER_PAGE,
  ListJobsUseCase,
  MAX_PER_PAGE,
} from '@/application/use-cases/list-jobs.use-case';
import { StubJobQueryRepository, jobListItem } from '../../../test/factories/doubles';
import { FIXED_NOW, hoursAgo } from '../../../test/factories/make-job';

describe('ListJobsUseCase', () => {
  let jobs: StubJobQueryRepository;
  let useCase: ListJobsUseCase;

  beforeEach(() => {
    jobs = new StubJobQueryRepository();
    useCase = new ListJobsUseCase(jobs);
  });

  it('aplica os padroes da aba Vagas', async () => {
    await useCase.execute({}, FIXED_NOW);

    expect(jobs.lastFilters).toMatchObject({
      page: 1,
      perPage: DEFAULT_PER_PAGE,
      sortBy: 'publishedAt',
      sortDirection: 'desc',
      publishedAfter: hoursAgo(72),
    });
  });

  it('repassa os filtros informados', async () => {
    await useCase.execute(
      {
        search: 'react',
        source: 'gupy',
        company: 'Acme Corp',
        recruiterName: 'octocat',
        isRemote: true,
        city: 'Salvador/BA',
        page: 3,
        perPage: 50,
        sortBy: 'company',
        sortDirection: 'asc',
      },
      FIXED_NOW,
    );

    expect(jobs.lastFilters).toMatchObject({
      search: 'react',
      source: 'gupy',
      company: 'Acme Corp',
      recruiterName: 'octocat',
      isRemote: true,
      city: 'Salvador/BA',
      page: 3,
      perPage: 50,
      sortBy: 'company',
      sortDirection: 'asc',
    });
  });

  describe('filtro de tecnologias', () => {
    it('repassa as tecnologias marcadas', async () => {
      await useCase.execute({ technologies: ['React', 'Node.js'] }, FIXED_NOW);

      expect(jobs.lastFilters?.technologies).toEqual(['React', 'Node.js']);
    });

    it('descarta espacos e entradas vazias', async () => {
      await useCase.execute({ technologies: ['  React  ', '', '   '] }, FIXED_NOW);

      expect(jobs.lastFilters?.technologies).toEqual(['React']);
    });

    it.each([
      ['lista vazia', []],
      ['so espacos', ['  ']],
      ['nao informadas', undefined],
    ])('trata %s como ausencia de filtro', async (_label, technologies) => {
      await useCase.execute({ technologies }, FIXED_NOW);

      expect(jobs.lastFilters?.technologies).toBeUndefined();
    });
  });

  describe('filtro de senioridade', () => {
    it('expande o nivel escolhido nos termos de busca', async () => {
      await useCase.execute({ seniorities: ['MID'] }, FIXED_NOW);

      expect(jobs.lastFilters?.seniorityKeywords).toContain('pleno');
    });

    it('inclui a variante com acento do nivel senior', async () => {
      await useCase.execute({ seniorities: ['SENIOR'] }, FIXED_NOW);

      expect(jobs.lastFilters?.seniorityKeywords).toEqual(
        expect.arrayContaining(['senior', 'sênior']),
      );
    });

    it('junta os termos de varios niveis', async () => {
      await useCase.execute({ seniorities: ['JUNIOR', 'SENIOR'] }, FIXED_NOW);

      expect(jobs.lastFilters?.seniorityKeywords).toEqual(
        expect.arrayContaining(['junior', 'senior']),
      );
    });

    it.each([
      ['lista vazia', []],
      ['nivel invalido', ['ARQUITETO']],
      ['nao informada', undefined],
    ])('trata %s como ausencia de filtro', async (_label, seniorities) => {
      await useCase.execute({ seniorities }, FIXED_NOW);

      expect(jobs.lastFilters?.seniorityKeywords).toBeUndefined();
    });
  });

  it.each([['nacionais','NATIONAL'],['internacionais','INTERNATIONAL']] as const)(
    'repassa o filtro de vagas %s',
    async (_label, scope) => {
      await useCase.execute({ scope }, FIXED_NOW);

      expect(jobs.lastFilters?.scope).toBe(scope);
    },
  );

  it('nao filtra mercado quando nao e informado', async () => {
    await useCase.execute({}, FIXED_NOW);

    expect(jobs.lastFilters?.scope).toBeUndefined();
  });

  it('nao limita a janela quando pedem vagas expiradas', async () => {
    await useCase.execute({ includeExpired: true }, FIXED_NOW);

    expect(jobs.lastFilters?.publishedAfter).toBeUndefined();
  });

  it.each([
    ['pagina zero', { page: 0 }, 1],
    ['pagina negativa', { page: -2 }, 1],
    ['pagina fracionaria', { page: 2.9 }, 2],
  ])('normaliza %s', async (_label, input, expected) => {
    await useCase.execute(input, FIXED_NOW);

    expect(jobs.lastFilters?.page).toBe(expected);
  });

  it.each([
    ['acima do maximo', { perPage: 500 }, MAX_PER_PAGE],
    ['zero', { perPage: 0 }, DEFAULT_PER_PAGE],
    ['nao numerico', { perPage: Number.NaN }, DEFAULT_PER_PAGE],
  ])('normaliza perPage %s', async (_label, input, expected) => {
    await useCase.execute(input, FIXED_NOW);

    expect(jobs.lastFilters?.perPage).toBe(expected);
  });

  it('calcula o total de paginas', async () => {
    jobs.items = Array.from({ length: 3 }, (_unused, index) =>
      jobListItem({ id: `job-${index}` }),
    );

    const result = await useCase.execute({ perPage: 2 }, FIXED_NOW);

    expect(result).toMatchObject({ total: 3, perPage: 2, page: 1, totalPages: 2 });
  });

  it('devolve lista vazia sem erro', async () => {
    const result = await useCase.execute({}, FIXED_NOW);

    expect(result).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('usa o horario atual quando nenhuma referencia e informada', async () => {
    await useCase.execute();

    expect(jobs.lastFilters?.publishedAfter).toBeInstanceOf(Date);
  });

  it('usa a entrada vazia como padrao', async () => {
    await expect(useCase.execute()).resolves.toMatchObject({ page: 1 });
  });

  describe('abas Empresas e Recrutadores', () => {
    it('lista empresas contratando nas ultimas 72h', async () => {
      jobs.companies = [
        { name: 'Acme Corp', total: 4, remoteTotal: 3, lastPublishedAt: hoursAgo(1) },
      ];

      await expect(useCase.listCompanies(FIXED_NOW)).resolves.toEqual(jobs.companies);
    });

    it('lista recrutadores que publicaram nas ultimas 72h', async () => {
      jobs.recruiters = [
        { name: 'octocat', total: 2, remoteTotal: 2, lastPublishedAt: hoursAgo(5) },
      ];

      await expect(useCase.listRecruiters(FIXED_NOW)).resolves.toEqual(jobs.recruiters);
    });

    it('usa o horario atual quando nenhuma referencia e informada', async () => {
      await expect(useCase.listCompanies()).resolves.toEqual([]);
      await expect(useCase.listRecruiters()).resolves.toEqual([]);
    });
  });
});
