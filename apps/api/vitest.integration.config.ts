import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Testes de integracao: rodam contra um Postgres real, em um banco separado
 * (`devradar_test`), e por isso ficam fora do `npm test` do dia a dia.
 */
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.int-spec.ts'],
    setupFiles: ['test/setup.ts'],
    // Os testes compartilham o mesmo banco: rodar em serie evita corrida no TRUNCATE.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
