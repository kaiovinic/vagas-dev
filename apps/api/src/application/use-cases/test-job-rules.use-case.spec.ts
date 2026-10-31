import { beforeEach, describe, expect, it } from 'vitest';

import { TestJobRulesUseCase } from '@/application/use-cases/test-job-rules.use-case';
import { InvalidJobError } from '@/domain/errors/invalid-job-error';
import { JobRejectionReason, JobRuleEngine } from '@/domain/services/job-rule-engine';
import { FIXED_NOW, hoursAgo } from '../../../test/factories/make-job';

describe('TestJobRulesUseCase', () => {
  let useCase: TestJobRulesUseCase;

  beforeEach(() => {
    useCase = new TestJobRulesUseCase(new JobRuleEngine());
  });

  describe('getPublicRules', () => {
    it('devolve as regras publicas do motor de regras', () => {
      const rules = useCase.getPublicRules();

      expect(rules.publicationWindowInHours).toBe(72);
      expect(rules.rules.map((rule) => rule.id)).toEqual([
        'publication-window',
        'stack-match',
        'location-match',
        'spam-filter',
        'national-scope',
        'post-hiring-signal',
        'post-aggregator-account',
      ]);
    });
  });

  describe('execute', () => {
    it('aprova um texto de vaga valido', () => {
      const result = useCase.execute(
        { text: 'Pessoa Desenvolvedora Frontend React\nVaga 100% remota para o Brasil.' },
        FIXED_NOW,
      );

      expect(result.approved).toBe(true);
      expect(result.rejectionReasons).toEqual([]);
      expect(result.matchedStack).toEqual(expect.arrayContaining(['React', 'Frontend']));
      expect(result.matchedLocations).toContain('Remoto');
    });

    it('usa a primeira linha como titulo avaliado', () => {
      const result = useCase.execute(
        { text: 'Dev Frontend React em Salvador\nDetalhes abaixo...' },
        FIXED_NOW,
      );

      expect(result.evaluated.title).toBe('Dev Frontend React em Salvador');
    });

    it('explica cada regra reprovada', () => {
      const result = useCase.execute(
        {
          text: 'Curso de React do zero ao avancado, inscricoes abertas',
          location: 'Sao Paulo/SP',
          workModel: 'ONSITE',
          publishedAt: hoursAgo(200),
        },
        FIXED_NOW,
      );

      expect(result.approved).toBe(false);
      expect(result.rejectionReasons).toEqual([
        JobRejectionReason.ExpiredPublication,
        JobRejectionReason.LocationNotAllowed,
        JobRejectionReason.SpamDetected,
      ]);
      expect(result.matchedSpamTerms).toEqual(
        expect.arrayContaining(['Curso', 'Inscricoes abertas']),
      );
    });

    it('assume empresa e link placeholder quando nao informados', () => {
      const result = useCase.execute({ text: 'Dev Frontend React remoto' }, FIXED_NOW);

      expect(result.evaluated.company).toBe('Empresa nao informada');
      expect(result.evaluated.url).toBe('https://devradar.local/teste-de-regras');
    });

    it('preserva empresa, localidade e modalidade informadas', () => {
      const result = useCase.execute(
        {
          text: 'Dev Angular pleno',
          company: '  Acme Corp  ',
          location: ' Lauro de Freitas/BA ',
          workModel: 'HYBRID',
        },
        FIXED_NOW,
      );

      expect(result.evaluated).toMatchObject({
        company: 'Acme Corp',
        location: 'Lauro de Freitas/BA',
        workModel: 'HYBRID',
      });
      expect(result.matchedLocations).toContain('Lauro de Freitas/BA');
    });

    it('aceita o link como url da vaga quando e http', () => {
      const result = useCase.execute(
        { text: 'Dev Frontend React remoto', url: 'https://gupy.io/vagas/1' },
        FIXED_NOW,
      );

      expect(result.evaluated.url).toBe('https://gupy.io/vagas/1');
    });

    it('avalia apenas o link quando nenhum texto e colado', () => {
      const result = useCase.execute(
        { text: '   ', url: 'https://gupy.io/vagas/desenvolvedor-frontend-react-remoto' },
        FIXED_NOW,
      );

      expect(result.evaluated.title).toBe(
        'https://gupy.io/vagas/desenvolvedor-frontend-react-remoto',
      );
      expect(result.matchedStack).toContain('React');
    });

    it('ignora link que nao e http e mantem o placeholder', () => {
      const result = useCase.execute(
        { text: 'Dev Frontend React remoto', url: 'gupy.io/vagas/1' },
        FIXED_NOW,
      );

      expect(result.evaluated.url).toBe('https://devradar.local/teste-de-regras');
    });

    it('usa a data informada na avaliacao da janela de 72h', () => {
      const publishedAt = hoursAgo(80);

      const result = useCase.execute(
        { text: 'Dev Frontend React remoto', publishedAt },
        FIXED_NOW,
      );

      expect(result.evaluated.publishedAt).toEqual(publishedAt);
      expect(result.rejectionReasons).toContain(JobRejectionReason.ExpiredPublication);
    });

    it('recusa a requisicao sem texto e sem link', () => {
      expect(() => useCase.execute({ text: '   ' }, FIXED_NOW)).toThrow(InvalidJobError);
    });

    it('trunca titulos muito longos', () => {
      const result = useCase.execute({ text: `React ${'a'.repeat(400)}` }, FIXED_NOW);

      expect(result.evaluated.title).toHaveLength(180);
    });

    it('usa o horario atual quando nenhuma referencia e informada', () => {
      const result = useCase.execute({ text: 'Dev Frontend React remoto' });

      expect(result.approved).toBe(true);
    });
  });
});
