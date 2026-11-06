import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Mais simples que o do @devradar/api de proposito: aqui nao ha Nest, entao nao
 * ha decorators nem metadata para transformar.
 *
 * Os testes nao abrem navegador. O que se testa com Vitest e a logica pura — a
 * leitura de URL hoje, o parser do DOM (sobre HTML salvo) na Fase 2. Navegar
 * contra o LinkedIn de verdade a cada CI e o caminho mais curto para derrubar a
 * sessao, e por isso nao e feito.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
