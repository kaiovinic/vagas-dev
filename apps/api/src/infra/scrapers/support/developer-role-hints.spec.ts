import { describe, expect, it } from 'vitest';

import {
  DEVELOPER_ROLE_HINTS,
  looksLikeDeveloperRole,
} from '@/infra/scrapers/support/developer-role-hints';

describe('looksLikeDeveloperRole', () => {
  it('reconhece o cargo escrito de varias formas', () => {
    expect(looksLikeDeveloperRole('Desenvolvedor Full Stack')).toBe(true);
    expect(looksLikeDeveloperRole('Pessoa Desenvolvedora React')).toBe(true);
    expect(looksLikeDeveloperRole('Software Engineer')).toBe(true);
    expect(looksLikeDeveloperRole('Programadora .NET')).toBe(true);
  });

  it('ignora acento e caixa, como o resto do dominio', () => {
    expect(looksLikeDeveloperRole('ENGENHEIRO DE SOFTWARE')).toBe(true);
    expect(looksLikeDeveloperRole('desenvolvedora de sistemas')).toBe(true);
  });

  it('recusa cargo de outra area', () => {
    expect(looksLikeDeveloperRole('Analista de Departamento Pessoal')).toBe(false);
    expect(looksLikeDeveloperRole('Teste Vaga De Publicacao')).toBe(false);
    expect(looksLikeDeveloperRole('')).toBe(false);
  });

  /**
   * O recorte nao e a regra de stack: ele diz apenas "isto e cargo de
   * desenvolvimento". Quem decide se a vaga serve e o `JobRuleEngine`.
   */
  it('aceita cargo de desenvolvimento fora da stack do radar', () => {
    expect(looksLikeDeveloperRole('Desenvolvedor Java')).toBe(true);
    expect(DEVELOPER_ROLE_HINTS).toContain('desenvolvedor');
  });
});
