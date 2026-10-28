import { describe, expect, it } from 'vitest';

import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import {
  collapseSpaces,
  dedupeByUrl,
  parseDate,
  toAbsoluteUrl,
  uniqueStrings,
  workModelFromText,
} from '@/infra/scrapers/support/scraper-helpers';

describe('scraper-helpers', () => {
  describe('collapseSpaces', () => {
    it('colapsa espacos, quebras de linha e tabulacoes', () => {
      expect(collapseSpaces('  Dev \n\t Frontend  ')).toBe('Dev Frontend');
    });
  });

  describe('toAbsoluteUrl', () => {
    it('resolve href relativo contra a origem da fonte', () => {
      expect(toAbsoluteUrl('https://acme.com', '/jobs/1')).toBe('https://acme.com/jobs/1');
    });

    it('descarta a query de tracking', () => {
      expect(toAbsoluteUrl('https://acme.com', 'https://acme.com/jobs/1?ref=abc')).toBe(
        'https://acme.com/jobs/1',
      );
    });

    it.each([
      ['href vazio', ''],
      ['href relativo sem base valida', '/jobs/1'],
    ])('devolve undefined para %s', (_label, href) => {
      expect(toAbsoluteUrl('nao-e-base', href)).toBeUndefined();
    });
  });

  describe('parseDate', () => {
    const NOW = new Date('2026-10-26T23:00:00.000Z');

    it('converte texto ISO em data', () => {
      expect(parseDate('2026-10-26T10:00:00Z')?.toISOString()).toBe('2026-10-26T10:00:00.000Z');
    });

    it('preserva o instante exato quando a fonte informa a hora', () => {
      expect(parseDate('2026-10-25T08:30:00.000-03:00', NOW)?.toISOString()).toBe(
        '2026-10-25T11:30:00.000Z',
      );
    });

    describe('data informada so com o dia', () => {
      it('vira meio-dia de Brasilia, nao meia-noite UTC', () => {
        expect(parseDate('2026-10-25', NOW)?.toISOString()).toBe('2026-10-25T15:00:00.000Z');
      });

      it('cai no mesmo dia em Brasilia e em UTC', () => {
        const parsed = parseDate('2026-10-25', NOW);
        const emBrasilia = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Bahia',
          day: '2-digit',
          month: '2-digit',
        }).format(parsed);

        expect(emBrasilia).toBe('25/10');
        expect(parsed?.toISOString().slice(0, 10)).toBe('2026-10-25');
      });

      it('nao devolve data no futuro quando o dia e hoje', () => {
        // Captura as 06:00 UTC (03:00 em Brasilia): o meio-dia ainda nao chegou.
        const manha = new Date('2026-10-26T06:00:00.000Z');

        expect(parseDate('2026-10-26', manha)).toEqual(manha);
      });

      it('mantem o meio-dia quando ele ja passou', () => {
        expect(parseDate('2026-10-26', NOW)?.toISOString()).toBe('2026-10-26T15:00:00.000Z');
      });

      it('usa o horario atual como limite quando nenhuma referencia e informada', () => {
        expect(parseDate('2026-10-25')?.toISOString()).toBe('2026-10-25T15:00:00.000Z');
      });
    });

    it.each([
      ['undefined', undefined],
      ['nulo', null],
      ['numero', 1_700_000_000],
      ['texto vazio', '  '],
      ['texto invalido', 'ontem'],
    ])('devolve undefined para %s', (_label, value) => {
      expect(parseDate(value)).toBeUndefined();
    });
  });

  describe('workModelFromText', () => {
    it.each([
      ['100% Remoto', 'REMOTE'],
      ['Home Office', 'REMOTE'],
      ['Trabalho remote', 'REMOTE'],
      ['Híbrido - Salvador', 'HYBRID'],
      ['Semi presencial', 'HYBRID'],
      ['Presencial em Salvador', 'ONSITE'],
      ['Alocado no cliente', 'ONSITE'],
      ['Salvador, Bahia', 'UNKNOWN'],
    ])('deriva a modalidade de "%s"', (text, expected) => {
      expect(workModelFromText(text)).toBe(expected);
    });

    it('prioriza remoto sobre presencial em textos ambiguos', () => {
      expect(workModelFromText('Remoto, com idas presenciais')).toBe('REMOTE');
    });
  });

  describe('dedupeByUrl', () => {
    it('mantem a primeira ocorrencia de cada url', () => {
      const jobs = [rawJob('https://a.com/1'), rawJob('https://a.com/2'), rawJob('https://a.com/1')];

      expect(dedupeByUrl(jobs)).toHaveLength(2);
    });

    it('devolve lista vazia para entrada vazia', () => {
      expect(dedupeByUrl([])).toEqual([]);
    });
  });

  describe('uniqueStrings', () => {
    it('normaliza, remove vazios e duplicatas preservando a ordem', () => {
      expect(uniqueStrings([' React ', 'React', '', '  ', 'Node  JS'])).toEqual([
        'React',
        'Node JS',
      ]);
    });
  });
});

function rawJob(url: string): RawJobProps {
  return {
    title: 'Dev Frontend',
    company: 'Acme',
    source: 'test',
    url,
    publishedAtSource: 'SOURCE',
  };
}
