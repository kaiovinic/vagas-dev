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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/scripts/**'],
      thresholds: {
        /**
         * O parser e a unica parte do worker que nao depende do navegador, e
         * por isso a unica que da para cobrir de verdade. Cobertura total aqui
         * nao e vaidade: quando o LinkedIn mudar o layout, e este teste que
         * falha primeiro e diz o que mudou, em vez de a producao emudecer.
         */
        'src/parser/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        /**
         * A outra parte que nao depende do navegador: o servidor que serve o
         * cache. Aqui cada caminho e um jeito diferente de a API ser atendida —
         * colheita boa, ausente, ilegivel, em gravacao — e o que nao estiver
         * coberto e exatamente o que vai aparecer em producao as 3h da manha.
         */
        'src/server/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
});
