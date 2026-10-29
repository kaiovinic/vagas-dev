import { beforeEach, describe, expect, it } from 'vitest';

import {
  JobRejectionReason,
  JobRuleEngine,
  PUBLICATION_WINDOW_IN_HOURS,
} from '@/domain/services/job-rule-engine';
import { FIXED_NOW, hoursAgo, makeJob } from '../../../test/factories/make-job';

describe('JobRuleEngine (domain service)', () => {
  let engine: JobRuleEngine;

  beforeEach(() => {
    engine = new JobRuleEngine();
  });

  describe('vaga aprovada', () => {
    it('aprova vaga recente, da stack, remota e sem spam', () => {
      const result = engine.evaluate(makeJob(), FIXED_NOW);

      expect(result.approved).toBe(true);
      expect(result.rejectionReasons).toEqual([]);
    });

    it('expoe os criterios atendidos', () => {
      const job = makeJob({
        title: 'Pessoa Desenvolvedora Fullstack (React + Node.js)',
        location: 'Salvador/BA',
        workModel: 'ONSITE',
      });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.approved).toBe(true);
      expect(result.matchedStack).toEqual(
        expect.arrayContaining(['React', 'Node.js', 'Fullstack', 'TypeScript']),
      );
      expect(result.matchedLocations).toContain('Salvador/BA');
      expect(result.matchedSpamTerms).toEqual([]);
    });

    it('isApproved e um atalho booleano do evaluate', () => {
      expect(engine.isApproved(makeJob(), FIXED_NOW)).toBe(true);
      expect(engine.isApproved(makeJob({ publishedAt: hoursAgo(100) }), FIXED_NOW)).toBe(false);
    });

    it('usa a data atual quando a referencia nao e informada', () => {
      const job = makeJob({ publishedAt: new Date(Date.now() - 60 * 60 * 1000) });

      expect(engine.isApproved(job)).toBe(true);
    });

    it('filtra uma colecao mantendo apenas as vagas aprovadas', () => {
      const approved = makeJob({ title: 'Dev React', company: 'Acme' });
      const expired = makeJob({ title: 'Dev React', company: 'Old Corp', publishedAt: hoursAgo(80) });
      const spam = makeJob({ title: 'Curso de React', company: 'Escola', description: 'Bootcamp com mentoria' });

      expect(engine.filter([approved, expired, spam], FIXED_NOW)).toEqual([approved]);
    });
  });

  describe('regra 1: janela de publicacao de 72 horas', () => {
    it('declara a janela de 72 horas', () => {
      expect(PUBLICATION_WINDOW_IN_HOURS).toBe(72);
    });

    it.each([0, 1, 48, 71.9])('aprova vaga publicada ha %s horas', (hours) => {
      const result = engine.evaluate(makeJob({ publishedAt: hoursAgo(hours) }), FIXED_NOW);

      expect(result.rejectionReasons).not.toContain(JobRejectionReason.ExpiredPublication);
    });

    it.each([72.1, 73, 240])('rejeita vaga publicada ha %s horas', (hours) => {
      const result = engine.evaluate(makeJob({ publishedAt: hoursAgo(hours) }), FIXED_NOW);

      expect(result.approved).toBe(false);
      expect(result.rejectionReasons).toContain(JobRejectionReason.ExpiredPublication);
    });

    it('aprova exatamente no limite de 72 horas', () => {
      const result = engine.evaluate(makeJob({ publishedAt: hoursAgo(72) }), FIXED_NOW);

      expect(result.rejectionReasons).not.toContain(JobRejectionReason.ExpiredPublication);
    });

    it('rejeita vaga com data de publicacao no futuro', () => {
      const result = engine.evaluate(makeJob({ publishedAt: hoursAgo(-2) }), FIXED_NOW);

      expect(result.approved).toBe(false);
      expect(result.rejectionReasons).toContain(JobRejectionReason.ExpiredPublication);
    });
  });

  describe('regra 2: stack Frontend/Fullstack', () => {
    const stackCases: ReadonlyArray<readonly [string, string]> = [
      ['React', 'Pessoa Desenvolvedora React'],
      ['React', 'Vaga para ReactJS pleno'],
      ['Next.js', 'Dev Next.js senior'],
      ['Next.js', 'Dev NextJS senior'],
      ['TypeScript', 'Programador TypeScript'],
      ['Node.js', 'Engenheiro Node.js'],
      ['Node.js', 'Engenheiro NodeJS'],
      ['Angular', 'Desenvolvedor Angular'],
      ['Angular', 'Desenvolvedor AngularJS'],
      ['C#', 'Desenvolvedor C# pleno'],
      ['C#', 'Desenvolvedor CSharp pleno'],
      ['.NET', 'Dev .NET senior'],
      ['.NET', 'Dev ASP.NET senior'],
      ['.NET', 'Dev Dotnet senior'],
      ['Frontend', 'Analista Frontend'],
      ['Frontend', 'Analista Front-end'],
      ['Frontend', 'Analista Front End'],
      ['Fullstack', 'Analista Fullstack'],
      ['Fullstack', 'Analista Full-stack'],
      ['Fullstack', 'Analista Full Stack'],
    ];

    it.each(stackCases)('reconhece %s em "%s"', (expectedLabel, title) => {
      const result = engine.evaluate(makeJob({ title, description: '' }), FIXED_NOW);

      expect(result.matchedStack).toContain(expectedLabel);
      expect(result.rejectionReasons).not.toContain(JobRejectionReason.StackNotMatched);
    });

    it('reconhece a stack citada apenas na descricao', () => {
      const job = makeJob({
        title: 'Pessoa Desenvolvedora Pleno',
        description: 'Trabalhamos com Angular e .NET no dia a dia.',
      });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.matchedStack).toEqual(expect.arrayContaining(['Angular', '.NET']));
    });

    it('rejeita vaga fora da stack', () => {
      const job = makeJob({
        title: 'Analista de Suporte Tecnico',
        description: 'Atendimento ao cliente e abertura de tickets.',
      });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.approved).toBe(false);
      expect(result.rejectionReasons).toContain(JobRejectionReason.StackNotMatched);
      expect(result.matchedStack).toEqual([]);
    });

    it.each([
      ['Reactor Industrial', 'Operador de Reactor Industrial'],
      ['Nodulo', 'Especialista em Nodulo pulmonar'],
    ])('nao confunde palavras parecidas: %s', (_label, title) => {
      const result = engine.evaluate(makeJob({ title, description: '' }), FIXED_NOW);

      expect(result.rejectionReasons).toContain(JobRejectionReason.StackNotMatched);
    });
  });

  describe('regra 3: localidade Remoto ou Salvador/BA', () => {
    it('aprova quando a modalidade da vaga e remota', () => {
      const job = makeJob({ location: 'Sao Paulo/SP', workModel: 'REMOTE' });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.rejectionReasons).not.toContain(JobRejectionReason.LocationNotAllowed);
      expect(result.matchedLocations).toContain('Remoto');
    });

    it.each([
      'Remoto',
      '100% Remota',
      'Home Office',
      'Trabalho remoto (Brasil)',
      'Remote - LATAM',
    ])('aprova localidade textual "%s"', (location) => {
      const job = makeJob({ location, workModel: 'UNKNOWN' });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.rejectionReasons).not.toContain(JobRejectionReason.LocationNotAllowed);
    });

    it.each([
      ['Salvador/BA', 'Salvador/BA'],
      ['Salvador/BA', 'Salvador - Bahia'],
      ['Lauro de Freitas/BA', 'Lauro de Freitas/BA'],
      ['Camacari/BA', 'Camaçari - BA'],
      ['Simoes Filho/BA', 'Simoes Filho/BA'],
      ['Candeias/BA', 'Candeias/BA'],
      ["Dias d'Avila/BA", "Dias d'Ávila - BA"],
      ['Madre de Deus/BA', 'Madre de Deus/BA'],
      ['Sao Francisco do Conde/BA', 'Sao Francisco do Conde/BA'],
      ['Mata de Sao Joao/BA', 'Mata de Sao Joao/BA'],
      ['Pojuca/BA', 'Pojuca/BA'],
      ['Sao Sebastiao do Passe/BA', 'Sao Sebastiao do Passe/BA'],
      ['Itaparica/BA', 'Itaparica/BA'],
      ['Vera Cruz/BA', 'Vera Cruz/BA'],
    ])('aprova %s da regiao metropolitana', (expectedLabel, location) => {
      const job = makeJob({ location, workModel: 'ONSITE' });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.matchedLocations).toContain(expectedLabel);
      expect(result.rejectionReasons).not.toContain(JobRejectionReason.LocationNotAllowed);
    });

    it('reconhece a localidade citada na descricao', () => {
      const job = makeJob({
        location: '',
        description: 'Atuacao hibrida no escritorio de Salvador, Bahia.',
        workModel: 'HYBRID',
      });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.rejectionReasons).not.toContain(JobRejectionReason.LocationNotAllowed);
    });

    it.each([
      'Sao Paulo/SP',
      'Rio de Janeiro/RJ',
      'Belo Horizonte/MG',
      'Feira de Santana/BA',
    ])('rejeita localidade presencial fora da area: %s', (location) => {
      const job = makeJob({ location, description: 'Vaga React presencial', workModel: 'ONSITE' });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.approved).toBe(false);
      expect(result.rejectionReasons).toContain(JobRejectionReason.LocationNotAllowed);
      expect(result.matchedLocations).toEqual([]);
    });

    it('rejeita vaga sem nenhuma informacao de localidade', () => {
      const job = makeJob({ location: '', description: 'Vaga React', workModel: 'UNKNOWN' });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.rejectionReasons).toContain(JobRejectionReason.LocationNotAllowed);
    });
  });

  describe('regra 4: higienizacao de spam', () => {
    it.each([
      ['Curso', 'Curso de React do zero ao avancado'],
      ['Bootcamp', 'Bootcamp Fullstack com vagas garantidas'],
      ['Mentoria', 'Mentoria individual para devs React'],
      ['Imersao', 'Imersao Frontend de 5 dias'],
      ['Inscricoes abertas', 'Inscricoes abertas para a turma de TypeScript'],
      ['Grupo de vagas', 'Entre no nosso grupo de vagas de React'],
      ['Lista de vagas', 'Lista de vagas Frontend atualizada'],
      ['#opentowork', 'Dev React #opentowork'],
      ['Open to work', 'Dev Angular open to work'],
      ['Meu curriculo', 'Divulgo meu curriculo de Dev Node.js'],
      ['Busco oportunidade', 'Busco oportunidade como Dev Frontend'],
      ['Recolocacao', 'Dev .NET em busca de recolocacao'],
      ['Trilha de estudos', 'Trilha de estudos de Angular gratuita'],
      ['E-book', 'E-book gratuito de React'],
      ['Masterclass', 'Masterclass de Next.js'],
    ])('rejeita publicacao com termo de spam: %s', (expectedTerm, title) => {
      const result = engine.evaluate(makeJob({ title }), FIXED_NOW);

      expect(result.approved).toBe(false);
      expect(result.rejectionReasons).toContain(JobRejectionReason.SpamDetected);
      expect(result.matchedSpamTerms).toContain(expectedTerm);
    });

    it('detecta spam presente apenas na descricao', () => {
      const job = makeJob({ description: 'Participe do nosso bootcamp antes de se candidatar.' });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.rejectionReasons).toContain(JobRejectionReason.SpamDetected);
    });

    it('nao marca como spam uma vaga legitima que pede curso superior', () => {
      const job = makeJob({ description: 'Requisito: curso superior completo em TI e React.' });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.matchedSpamTerms).toEqual([]);
      expect(result.approved).toBe(true);
    });

    it('nao marca como spam a palavra concurso', () => {
      const job = makeJob({ description: 'Concurso interno de inovacao com React.' });

      expect(engine.evaluate(job, FIXED_NOW).matchedSpamTerms).toEqual([]);
    });
  });

  describe('falsos positivos de localidade', () => {
    it('nao aceita San Salvador, capital de El Salvador, como Salvador/BA', () => {
      const job = makeJob({
        title: 'Desenvolvedor React',
        location: 'San Salvador',
        workModel: 'ONSITE',
        description: 'Vaga presencial',
      });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.matchedLocations).not.toContain('Salvador/BA');
      expect(result.rejectionReasons).toContain(JobRejectionReason.LocationNotAllowed);
    });

    it('continua aceitando Salvador de verdade', () => {
      const job = makeJob({
        title: 'Desenvolvedor React',
        location: 'Salvador - BA',
        workModel: 'ONSITE',
      });

      expect(engine.evaluate(job, FIXED_NOW).matchedLocations).toContain('Salvador/BA');
    });
  });

  describe('cargo de desenvolvimento web sem framework no titulo', () => {
    it.each([
      'Desenvolvedor Web',
      'Desenvolvedora Web Pleno',
      'Programador Web',
      'Web Developer',
    ])('aceita "%s"', (title) => {
      const job = makeJob({ title, description: 'Vaga presencial', location: 'Salvador/BA' });

      expect(engine.evaluate(job, FIXED_NOW).matchedStack).toContain('Desenvolvimento Web');
    });

    it('nao aceita a palavra "web" solta, que aparece em qualquer vaga', () => {
      const job = makeJob({
        title: 'Analista de Marketing',
        description: 'Cuidar do site web da empresa',
        location: 'Salvador/BA',
      });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.rejectionReasons).toContain(JobRejectionReason.StackNotMatched);
    });
  });

  describe('regra 5: somente mercado nacional', () => {
    it('reprova vaga marcada como internacional', () => {
      const job = makeJob({
        title: 'Senior React Developer',
        description: 'Remote position, work from anywhere in the world.',
      });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.approved).toBe(false);
      expect(result.rejectionReasons).toContain(JobRejectionReason.InternationalScope);
    });

    it('reprova quando o sinal de internacional vem nas tags da captura', () => {
      const job = makeJob({ title: 'Desenvolvedor React', description: 'Vaga remota' });

      const result = engine.evaluate(job, FIXED_NOW, ['Vaga internacional']);

      expect(result.rejectionReasons).toContain(JobRejectionReason.InternationalScope);
    });

    it.each(['LATAM', 'worldwide', 'pagamento em dolar'])(
      'reprova o marcador "%s"',
      (marcador) => {
        const job = makeJob({ title: 'Dev React', description: `Vaga remota, ${marcador}` });

        expect(engine.isApproved(job, FIXED_NOW)).toBe(false);
      },
    );

    it('aprova vaga nacional', () => {
      const job = makeJob({ title: 'Dev React', description: 'Vaga CLT remota' });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.approved).toBe(true);
      expect(result.scope).toBe('NATIONAL');
    });

    it('nao reprova vaga de escopo indefinido: so o internacional confirmado sai', () => {
      const job = makeJob({ title: 'Dev React', description: 'Vaga remota', location: '' });
      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.scope).toBe('UNKNOWN');
      expect(result.rejectionReasons).not.toContain(JobRejectionReason.InternationalScope);
    });

    it('CLT vence o sinal de internacional, como na classificacao de escopo', () => {
      const job = makeJob({
        title: 'Dev React',
        description: 'Vaga CLT com pagamento em dolar',
      });

      expect(engine.isApproved(job, FIXED_NOW)).toBe(true);
    });

    it('entrega o escopo ja classificado, para quem avalia nao calcular de novo', () => {
      const job = makeJob({ title: 'Dev React', description: 'Remote, worldwide' });

      expect(engine.evaluate(job, FIXED_NOW).scope).toBe('INTERNATIONAL');
    });

    it('repassa as tags ao filtrar em lote', () => {
      const nacional = makeJob({ title: 'Dev React', description: 'Vaga CLT' });
      const internacional = makeJob({
        title: 'Dev Node',
        company: 'Global Corp',
        description: 'Vaga remota worldwide',
      });

      expect(engine.filter([nacional, internacional], FIXED_NOW)).toEqual([nacional]);
    });
  });

  describe('acumulo de rejeicoes', () => {
    it('reporta todas as regras violadas', () => {
      const job = makeJob({
        title: 'Curso de Excel avancado',
        description: 'Inscricoes abertas, turma presencial.',
        location: 'Sao Paulo/SP',
        publishedAt: hoursAgo(200),
        workModel: 'ONSITE',
      });

      const result = engine.evaluate(job, FIXED_NOW);

      expect(result.approved).toBe(false);
      expect(result.rejectionReasons).toEqual([
        JobRejectionReason.ExpiredPublication,
        JobRejectionReason.StackNotMatched,
        JobRejectionReason.LocationNotAllowed,
        JobRejectionReason.SpamDetected,
      ]);
    });
  });

  describe('getPublicRules', () => {
    it('expoe a janela de publicacao e a versao das regras', () => {
      const publicRules = engine.getPublicRules();

      expect(publicRules.publicationWindowInHours).toBe(PUBLICATION_WINDOW_IN_HOURS);
      expect(publicRules.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('expoe as cinco regras na ordem de avaliacao', () => {
      const ids = engine.getPublicRules().rules.map((rule) => rule.id);

      expect(ids).toEqual([
        'publication-window',
        'stack-match',
        'location-match',
        'spam-filter',
        'national-scope',
      ]);
    });

    it('descreve cada regra com nome, descricao, tipo e motivo de rejeicao', () => {
      for (const rule of engine.getPublicRules().rules) {
        expect(rule.name.length).toBeGreaterThan(0);
        expect(rule.description.length).toBeGreaterThan(0);
        expect(rule.criteria.length).toBeGreaterThan(0);
        expect(Object.values(JobRejectionReason)).toContain(rule.rejectionReason);
      }
    });

    it('publica os marcadores que caracterizam vaga internacional', () => {
      const scopeRule = engine
        .getPublicRules()
        .rules.find((rule) => rule.id === 'national-scope');

      expect(scopeRule?.kind).toBe('SCOPE_DENY_LIST');
      expect(scopeRule?.rejectionReason).toBe(JobRejectionReason.InternationalScope);
      expect(scopeRule?.criteria).toContain('Internacional');
    });

    it('lista os criterios da stack aceita', () => {
      const stackRule = engine
        .getPublicRules()
        .rules.find((rule) => rule.id === 'stack-match');

      expect(stackRule?.kind).toBe('KEYWORD_ALLOW_LIST');
      expect(stackRule?.criteria).toEqual(
        expect.arrayContaining([
          'React',
          'Next.js',
          'TypeScript',
          'Node.js',
          'Angular',
          'C#',
          '.NET',
          'Frontend',
          'Fullstack',
        ]),
      );
    });

    it('lista Remoto e Salvador entre os criterios de localidade', () => {
      const locationRule = engine
        .getPublicRules()
        .rules.find((rule) => rule.id === 'location-match');

      expect(locationRule?.kind).toBe('LOCATION_ALLOW_LIST');
      expect(locationRule?.criteria).toEqual(
        expect.arrayContaining(['Remoto', 'Salvador/BA', 'Lauro de Freitas/BA']),
      );
    });

    it('lista os termos bloqueados da higienizacao', () => {
      const spamRule = engine
        .getPublicRules()
        .rules.find((rule) => rule.id === 'spam-filter');

      expect(spamRule?.kind).toBe('KEYWORD_DENY_LIST');
      expect(spamRule?.criteria).toEqual(
        expect.arrayContaining(['Curso', 'Bootcamp', 'Mentoria', '#opentowork']),
      );
    });

    it('descreve a janela de 72 horas no criterio da regra de frescor', () => {
      const windowRule = engine
        .getPublicRules()
        .rules.find((rule) => rule.id === 'publication-window');

      expect(windowRule?.kind).toBe('TIME_WINDOW');
      expect(windowRule?.criteria.join(' ')).toContain('72');
    });

    it('retorna uma estrutura imutavel para a aba publica', () => {
      const publicRules = engine.getPublicRules();

      expect(Object.isFrozen(publicRules)).toBe(true);
      expect(Object.isFrozen(publicRules.rules)).toBe(true);
    });
  });
});
