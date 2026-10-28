import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { jobListItem } from './factories/doubles';
import { createApiTestContext, type ApiTestContext } from './factories/make-api';
import { hoursAgo } from './factories/make-job';

describe('Jobs (E2E)', () => {
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

  describe('GET /api/jobs', () => {
    it('devolve a listagem paginada da aba Vagas', async () => {
      context.jobs.items = [
        jobListItem({ id: 'job-1', title: 'Dev React', company: 'Acme Corp' }),
        jobListItem({ id: 'job-2', title: 'Dev Angular', company: 'Globex' }),
      ];

      const response = await http().get('/api/jobs').expect(200);

      expect(response.body).toMatchObject({ total: 2, page: 1, perPage: 20, totalPages: 1 });
      expect(response.body.items.map((item: { title: string }) => item.title)).toEqual([
        'Dev React',
        'Dev Angular',
      ]);
    });

    it('aplica a janela de 72h e a ordenacao padrao', async () => {
      await http().get('/api/jobs').expect(200);

      expect(context.jobs.lastFilters).toMatchObject({
        sortBy: 'publishedAt',
        sortDirection: 'desc',
        page: 1,
        perPage: 20,
      });
      expect(context.jobs.lastFilters?.publishedAfter).toBeInstanceOf(Date);
    });

    it('repassa os filtros da query string', async () => {
      await http()
        .get('/api/jobs?search=react&source=gupy&isRemote=true&page=2&perPage=5&sortBy=company&sortDirection=asc')
        .expect(200);

      expect(context.jobs.lastFilters).toMatchObject({
        search: 'react',
        source: 'gupy',
        isRemote: true,
        page: 2,
        perPage: 5,
        sortBy: 'company',
        sortDirection: 'asc',
      });
    });

    it('aceita a lista de tecnologias separada por virgula', async () => {
      await http().get('/api/jobs?tech=React,Node.js,.NET').expect(200);

      expect(context.jobs.lastFilters?.technologies).toEqual(['React', 'Node.js', '.NET']);
    });

    it('tolera espacos e virgulas sobrando na lista de tecnologias', async () => {
      await http().get('/api/jobs?tech=%20React%20,,%20TypeScript%20').expect(200);

      expect(context.jobs.lastFilters?.technologies).toEqual(['React', 'TypeScript']);
    });

    it('nao filtra stack quando nenhuma tecnologia e marcada', async () => {
      await http().get('/api/jobs?tech=').expect(200);

      expect(context.jobs.lastFilters?.technologies).toBeUndefined();
    });

    it('aceita os niveis de senioridade separados por virgula', async () => {
      await http().get('/api/jobs?seniority=JUNIOR,SENIOR').expect(200);

      expect(context.jobs.lastFilters?.seniorityKeywords).toEqual(
        expect.arrayContaining(['junior', 'senior']),
      );
    });

    it('aceita o nivel em caixa baixa', async () => {
      await http().get('/api/jobs?seniority=pleno').expect(400);
      await http().get('/api/jobs?seniority=mid').expect(200);

      expect(context.jobs.lastFilters?.seniorityKeywords).toContain('pleno');
    });

    it('rejeita nivel desconhecido com 400', async () => {
      await http().get('/api/jobs?seniority=ARQUITETO').expect(400);
    });

    it('nao filtra senioridade quando nenhum nivel e marcado', async () => {
      await http().get('/api/jobs?seniority=').expect(200);

      expect(context.jobs.lastFilters?.seniorityKeywords).toBeUndefined();
    });

    it.each(['NATIONAL','INTERNATIONAL'])('aceita o mercado %s', async (scope) => {
      await http().get(`/api/jobs?scope=${scope}`).expect(200);

      expect(context.jobs.lastFilters?.scope).toBe(scope);
    });

    it('rejeita mercado desconhecido com 400', async () => {
      await http().get('/api/jobs?scope=MARTE').expect(400);
    });

    it('filtra por empresa, para a aba Empresas', async () => {
      await http().get('/api/jobs?company=Acme%20Corp').expect(200);

      expect(context.jobs.lastFilters?.company).toBe('Acme Corp');
    });

    it('filtra por recrutador, para a aba Recrutadores', async () => {
      await http().get('/api/jobs?recruiterName=octocat').expect(200);

      expect(context.jobs.lastFilters?.recruiterName).toBe('octocat');
    });

    it('permite incluir vagas fora da janela de 72h', async () => {
      await http().get('/api/jobs?includeExpired=true').expect(200);

      expect(context.jobs.lastFilters?.publishedAfter).toBeUndefined();
    });

    it('serializa as datas em ISO', async () => {
      const publishedAt = hoursAgo(2);
      context.jobs.items = [jobListItem({ publishedAt })];

      const response = await http().get('/api/jobs').expect(200);

      expect(response.body.items[0].publishedAt).toBe(publishedAt.toISOString());
      expect(response.body.items[0].publishedAtSource).toBe('SOURCE');
    });

    it.each([
      ['pagina invalida', 'page=0'],
      ['itens por pagina acima do limite', 'perPage=500'],
      ['ordenacao desconhecida', 'sortBy=salario'],
      ['direcao desconhecida', 'sortDirection=cima'],
      ['flag booleana invalida', 'isRemote=sim'],
    ])('rejeita %s com 400', async (_label, query) => {
      await http().get(`/api/jobs?${query}`).expect(400);
    });

    it('devolve lista vazia sem erro', async () => {
      const response = await http().get('/api/jobs').expect(200);

      expect(response.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
    });
  });

  describe('GET /api/jobs/companies', () => {
    it('devolve as empresas contratando nas ultimas 72h', async () => {
      context.jobs.companies = [
        { name: 'Acme Corp', total: 4, remoteTotal: 3, lastPublishedAt: hoursAgo(1) },
        { name: 'Globex', total: 1, remoteTotal: 0, lastPublishedAt: hoursAgo(10) },
      ];

      const response = await http().get('/api/jobs/companies').expect(200);

      expect(response.body).toEqual([
        {
          name: 'Acme Corp',
          total: 4,
          remoteTotal: 3,
          lastPublishedAt: hoursAgo(1).toISOString(),
        },
        {
          name: 'Globex',
          total: 1,
          remoteTotal: 0,
          lastPublishedAt: hoursAgo(10).toISOString(),
        },
      ]);
    });
  });

  describe('GET /api/jobs/recruiters', () => {
    it('devolve os recrutadores que publicaram nas ultimas 72h', async () => {
      context.jobs.recruiters = [
        { name: 'octocat', total: 2, remoteTotal: 2, lastPublishedAt: hoursAgo(3) },
      ];

      const response = await http().get('/api/jobs/recruiters').expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({ name: 'octocat', total: 2, remoteTotal: 2 });
    });

    it('devolve lista vazia quando nenhum recrutador publicou', async () => {
      const response = await http().get('/api/jobs/recruiters').expect(200);

      expect(response.body).toEqual([]);
    });
  });
});
