// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint do monorepo, deliberadamente curto.
 *
 * Criterio para uma regra entrar aqui: ela precisa pegar um defeito que o
 * `tsc --noEmit` NAO pega. Formatacao e estilo ficam de fora — ruido que
 * ninguem le e que esconde o aviso que importa.
 *
 * Um unico arquivo de configuracao na raiz atende os dois workspaces: o ESLint
 * procura a config subindo os diretorios a partir do arquivo analisado.
 */
export default tseslint.config(
  {
    // Precisa vir isolado, sem outras chaves, para valer globalmente.
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.config.{js,mjs,cjs}',
      '**/*.d.ts',
    ],
  },

  eslint.configs.recommended,

  // Checagem com informacao de tipo: sem ela, as regras que realmente importam
  // (promise solta, await em nao-promise) nao tem como funcionar.
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // O CLAUDE.md proibe `any`. O tsc so reclama de `any` implicito; o
      // explicito passa batido e e justamente o que costuma ser escrito.
      '@typescript-eslint/no-explicit-any': 'error',

      // A causa mais comum de erro engolido em codigo assincrono: uma promise
      // sem await cuja rejeicao nunca chega a lugar nenhum.
      '@typescript-eslint/no-floating-promises': 'error',

      // Passar uma funcao async onde se espera retorno sincrono (um
      // `onClick={async () => ...}` que rejeita em silencio, por exemplo).
      '@typescript-eslint/no-misused-promises': 'error',

      // `await` em valor que nao e promise: quase sempre um await esquecido
      // em outro lugar da expressao.
      '@typescript-eslint/await-thenable': 'error',

      // Um `case` novo em uma union obriga a tratar o caso em todo switch.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // Variavel nao usada e codigo morto; o `_` prefixado continua liberado
      // para parametro que existe so por posicao.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Ruido puro: o projeto usa template string com numero e com Date o
      // tempo todo, e isso e intencional.
      '@typescript-eslint/restrict-template-expressions': 'off',

      // Desligada de proposito. Um metodo `async` sem `await` dentro e normal
      // e correto quando ele implementa uma porta que devolve Promise — os
      // repositorios em memoria e os dubles de teste sao exatamente isso.
      // Manter a regra significaria espalhar `Promise.resolve()` decorativo.
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Arquivos de configuracao ficam fora do tsconfig dos workspaces, entao o
  // servico de tipos nao os conhece. Continuam passando pelas regras que nao
  // dependem de tipo.
  {
    files: ['**/*.config.ts', '**/*.config.mts'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // --- Frontend ----------------------------------------------------------
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Dependencia faltando em useEffect/useMemo da estado velho na tela —
      // um bug de verdade, e invisivel para o compilador.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // --- Testes ------------------------------------------------------------
  {
    files: ['**/*.spec.{ts,tsx}', '**/*.int-spec.ts', '**/test/**/*.{ts,tsx}'],
    rules: {
      // Dublê de teste precisa de acesso inseguro a objeto parcial; exigir
      // tipo exato aqui so leva a cast decorativo.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // `expect(obj.metodo).toHaveBeenCalled()` e a forma normal de asserir um
      // spy, e nunca chama o metodo — nao ha `this` para perder.
      '@typescript-eslint/unbound-method': 'off',

      // Varios testes lancam ou rejeitam DE PROPOSITO com algo que nao e Error
      // ('ECONNRESET cru'), justamente para provar que o codigo de producao
      // trata esse caso. A regra proibiria o teste que da a garantia.
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
    },
  },
);
