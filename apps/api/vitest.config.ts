import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    // Decorators + metadata sao obrigatorios para a injecao de dependencia do Nest
    // funcionar nos testes E2E.
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
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/index.ts',
        'src/main.ts',
        'src/app.module.ts',
        // Fiacao do Nest e conexao do Prisma: sem regra de negocio para testar.
        'src/**/*.module.ts',
        'src/infra/prisma/prisma.service.ts',
      ],
      thresholds: {
        // Dominio e aplicacao sao o nucleo de regras: cobertura total e obrigatoria.
        'src/domain/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/application/**': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
