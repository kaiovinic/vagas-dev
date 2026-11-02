import { parseMarkdown } from '@/lib/markdown';

/**
 * Nome do arquivo que o navegador vai sugerir no "Salvar como PDF".
 *
 * O dialogo nativo nao aceita um nome: ele usa o titulo da aba. Entao o titulo
 * vira o nome por alguns instantes, com o do candidato (o `h1` do curriculo) e a
 * empresa da vaga, para o arquivo nao chegar na pasta de downloads como
 * "DevRadar.pdf" em cima do anterior.
 */
export function resumeDocumentTitle(markdown: string, company: string | null): string {
  const parts = ['Curriculo', candidateName(markdown), company]
    .filter((part): part is string => part !== null && part.trim().length > 0)
    .map((part) => part.trim());

  return parts.join(' - ');
}

function candidateName(markdown: string): string | null {
  for (const block of parseMarkdown(markdown)) {
    if (block.kind === 'heading') {
      return block.level === 1 ? block.text : null;
    }
  }

  return null;
}

/**
 * Abre o dialogo de impressao com o titulo trocado, e devolve o titulo de antes.
 *
 * `window.print()` trava a aba enquanto o dialogo esta aberto nos navegadores de
 * desktop, mas o `finally` nao depende disso: mesmo que o dialogo volte na hora,
 * a aba nao fica com o nome do arquivo no lugar do nome do painel.
 */
export function printWithTitle(title: string): void {
  const previous = document.title;

  document.title = title;

  try {
    window.print();
  } finally {
    document.title = previous;
  }
}
