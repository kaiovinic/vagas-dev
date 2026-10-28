import { describe, expect, it } from 'vitest';

import { Job } from '@/domain/entities/job';
import { InvalidJobError } from '@/domain/errors/invalid-job-error';
import { FIXED_NOW, hoursAgo, makeJob } from '../../../test/factories/make-job';

describe('Job (entity)', () => {
  describe('criacao e normalizacao', () => {
    it('cria uma vaga valida expondo os dados normalizados', () => {
      const job = makeJob({
        title: '  Desenvolvedor Frontend React  ',
        company: '  Acme Corp  ',
        source: '  Gupy  ',
      });

      expect(job.title).toBe('Desenvolvedor Frontend React');
      expect(job.company).toBe('Acme Corp');
      expect(job.source).toBe('gupy');
    });

    it('assume valores vazios quando descricao e localidade nao sao informadas', () => {
      const job = Job.create({
        title: 'Dev Fullstack',
        company: 'Acme',
        source: 'linkedin',
        url: 'https://linkedin.com/jobs/1',
        publishedAt: hoursAgo(1),
      });

      expect(job.description).toBe('');
      expect(job.location).toBe('');
      expect(job.workModel).toBe('UNKNOWN');
    });

    it('preserva a modalidade informada', () => {
      expect(makeJob({ workModel: 'ONSITE' }).workModel).toBe('ONSITE');
      expect(makeJob({ workModel: 'HYBRID' }).workModel).toBe('HYBRID');
    });

    it('expoe a url e a data de publicacao', () => {
      const publishedAt = hoursAgo(5);
      const job = makeJob({ url: 'https://remotar.com.br/vaga/9', publishedAt });

      expect(job.url).toBe('https://remotar.com.br/vaga/9');
      expect(job.publishedAt).toEqual(publishedAt);
    });

    it('nao permite mutacao externa da data de publicacao', () => {
      const publishedAt = hoursAgo(5);
      const job = makeJob({ publishedAt });

      job.publishedAt.setFullYear(1999);

      expect(job.publishedAt.getFullYear()).toBe(publishedAt.getFullYear());
    });
  });

  describe('validacoes de dominio', () => {
    it.each([
      ['title', { title: '   ' }],
      ['company', { company: '' }],
      ['source', { source: '  ' }],
    ])('rejeita vaga sem %s', (_field, overrides) => {
      expect(() => makeJob(overrides)).toThrow(InvalidJobError);
    });

    it('rejeita url ausente ou com protocolo invalido', () => {
      expect(() => makeJob({ url: '' })).toThrow(InvalidJobError);
      expect(() => makeJob({ url: 'ftp://acme.com/vaga' })).toThrow(InvalidJobError);
      expect(() => makeJob({ url: 'nao-e-url' })).toThrow(InvalidJobError);
    });

    it('aceita urls http e https', () => {
      expect(makeJob({ url: 'http://acme.com/vaga' }).url).toBe('http://acme.com/vaga');
      expect(makeJob({ url: 'https://acme.com/vaga' }).url).toBe('https://acme.com/vaga');
    });

    it('rejeita data de publicacao invalida', () => {
      expect(() => makeJob({ publishedAt: new Date('data-invalida') })).toThrow(InvalidJobError);
    });

    it('rejeita modalidade desconhecida', () => {
      expect(() => makeJob({ workModel: 'TELEPATICO' as never })).toThrow(InvalidJobError);
    });

    it('descreve o campo invalido na mensagem de erro', () => {
      expect(() => makeJob({ title: '' })).toThrow(/title/i);
    });
  });

  describe('texto pesquisavel', () => {
    it('concatena titulo, descricao, localidade e empresa', () => {
      const job = makeJob({
        title: 'Dev Angular',
        description: 'Stack .NET',
        location: 'Lauro de Freitas',
        company: 'Acme',
      });

      expect(job.searchableText).toContain('Dev Angular');
      expect(job.searchableText).toContain('Stack .NET');
      expect(job.searchableText).toContain('Lauro de Freitas');
      expect(job.searchableText).toContain('Acme');
    });
  });

  describe('idade da publicacao', () => {
    it('calcula a idade em horas a partir de uma referencia', () => {
      const job = makeJob({ publishedAt: hoursAgo(30) });

      expect(job.ageInHours(FIXED_NOW)).toBeCloseTo(30, 5);
    });

    it('retorna idade negativa para vagas com data no futuro', () => {
      const job = makeJob({ publishedAt: hoursAgo(-4) });

      expect(job.ageInHours(FIXED_NOW)).toBeCloseTo(-4, 5);
    });
  });

  describe('identidade por fingerprint', () => {
    it('considera iguais vagas da mesma empresa e titulo em fontes diferentes', () => {
      const fromGupy = makeJob({ source: 'gupy', url: 'https://gupy.io/vagas/1' });
      const fromLinkedin = makeJob({
        source: 'linkedin',
        url: 'https://linkedin.com/jobs/2',
        title: 'desenvolvedor   frontend react',
      });

      expect(fromGupy.equals(fromLinkedin)).toBe(true);
      expect(fromGupy.fingerprint.value).toBe(fromLinkedin.fingerprint.value);
    });

    it('considera diferentes vagas de empresas distintas', () => {
      const acme = makeJob({ company: 'Acme Corp' });
      const globex = makeJob({ company: 'Globex' });

      expect(acme.equals(globex)).toBe(false);
    });
  });
});
