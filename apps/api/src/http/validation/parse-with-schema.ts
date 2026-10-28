import { BadRequestException } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Valida a entrada HTTP com zod e traduz o erro em 400 com a lista de problemas,
 * mantendo os controllers livres de `any` e de validacao manual.
 */
export function parseWithSchema<TSchema extends ZodTypeAny>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new BadRequestException({
      message: 'Parametros invalidos',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  // `z.infer<TSchema>` sobre um generico colapsa para `any` aos olhos do lint.
  // O valor aqui acabou de passar pelo `safeParse`: e exatamente o ponto em que
  // a entrada nao confiavel vira dado tipado.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return result.data;
}
