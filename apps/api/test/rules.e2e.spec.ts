import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApiTestContext, type ApiTestContext } from './factories/make-api';

describe('Rules (E2E)', () => {
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

  describe('GET /api/rules', () => {
    it('publica as quatro regras de transparencia', async () => {
      const response = await http().get('/api/rules').expect(200);

      expect(response.body.publicationWindowInHours).toBe(72);
      expect(response.body.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(response.body.rules.map((rule: { id: string }) => rule.id)).toEqual([
        'publication-window',
        'stack-match',
        'location-match',
        'spam-filter',
      ]);
    });

    it('descreve cada regra com criterios e motivo de rejeicao', async () => {
      const response = await http().get('/api/rules').expect(200);

      for (const rule of response.body.rules) {
        expect(rule.name.length).toBeGreaterThan(0);
        expect(rule.description.length).toBeGreaterThan(0);
        expect(rule.criteria.length).toBeGreaterThan(0);
        expect(rule.rejectionReason.length).toBeGreaterThan(0);
      }
    });

    it('lista a stack e os termos bloqueados', async () => {
      const response = await http().get('/api/rules').expect(200);
      const byId = (id: string): { criteria: string[] } =>
        response.body.rules.find((rule: { id: string }) => rule.id === id);

      expect(byId('stack-match').criteria).toContain('React');
      expect(byId('location-match').criteria).toContain('Salvador/BA');
      expect(byId('spam-filter').criteria).toContain('Bootcamp');
    });
  });

  describe('POST /api/rules/test', () => {
    it('aprova um texto de vaga valido', async () => {
      const response = await http()
        .post('/api/rules/test')
        .send({ text: 'Pessoa Desenvolvedora Frontend React\nVaga 100% remota.' })
        .expect(200);

      expect(response.body.approved).toBe(true);
      expect(response.body.rejectionReasons).toEqual([]);
      expect(response.body.matchedStack).toContain('React');
      expect(response.body.matchedLocations).toContain('Remoto');
    });

    it('explica por que uma publicacao foi reprovada', async () => {
      const response = await http()
        .post('/api/rules/test')
        .send({
          text: 'Bootcamp Fullstack com mentoria, inscricoes abertas',
          location: 'Sao Paulo/SP',
          workModel: 'ONSITE',
        })
        .expect(200);

      expect(response.body.approved).toBe(false);
      expect(response.body.rejectionReasons).toEqual(
        expect.arrayContaining(['LOCATION_NOT_ALLOWED', 'SPAM_DETECTED']),
      );
      expect(response.body.matchedSpamTerms).toEqual(
        expect.arrayContaining(['Bootcamp', 'Mentoria', 'Inscricoes abertas']),
      );
    });

    it('reprova vaga fora da janela de 72h', async () => {
      const response = await http()
        .post('/api/rules/test')
        .send({
          text: 'Dev Frontend React remoto',
          publishedAt: '2026-01-01T00:00:00.000Z',
        })
        .expect(200);

      expect(response.body.rejectionReasons).toContain('EXPIRED_PUBLICATION');
    });

    it('aceita apenas o link de uma vaga', async () => {
      const response = await http()
        .post('/api/rules/test')
        .send({ url: 'https://gupy.io/vagas/desenvolvedor-frontend-react-remoto' })
        .expect(200);

      expect(response.body.evaluated.url).toBe(
        'https://gupy.io/vagas/desenvolvedor-frontend-react-remoto',
      );
      expect(response.body.matchedStack).toContain('React');
    });

    it('devolve o que foi avaliado, para a aba mostrar o resultado', async () => {
      const response = await http()
        .post('/api/rules/test')
        .send({
          text: 'Dev Angular pleno',
          company: 'Acme Corp',
          location: 'Lauro de Freitas/BA',
          workModel: 'HYBRID',
        })
        .expect(200);

      expect(response.body.evaluated).toMatchObject({
        title: 'Dev Angular pleno',
        company: 'Acme Corp',
        location: 'Lauro de Freitas/BA',
        workModel: 'HYBRID',
      });
    });

    it.each([
      ['empresa so com pontuacao', { text: 'Dev Frontend React', company: '---' }],
      ['texto so com pontuacao', { text: '***' }],
    ])('devolve 400 do dominio quando %s nao gera fingerprint', async (_label, body) => {
      const response = await http().post('/api/rules/test').send(body).expect(400);

      expect(response.body.error).toBe('InvalidJobError');
      expect(response.body.message).toContain('fingerprint');
    });

    it.each([
      ['corpo vazio', {}],
      ['texto em branco', { text: '   ' }],
      ['modalidade desconhecida', { text: 'Dev React', workModel: 'TELEPATICO' }],
      ['data invalida', { text: 'Dev React', publishedAt: 'ontem' }],
    ])('rejeita %s com 400', async (_label, body) => {
      await http().post('/api/rules/test').send(body).expect(400);
    });
  });
});
