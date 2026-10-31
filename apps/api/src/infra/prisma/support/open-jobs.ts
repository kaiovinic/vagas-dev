import type { Prisma } from '@prisma/client';

/**
 * Recorte de vaga aberta: nao encerrada na fonte.
 *
 * Vale para TODA leitura — feed, KPIs, graficos, aba Mercado e resumo semanal.
 * Uma vaga que a fonte declarou acabada nao e oferta: contar "Vagas abertas"
 * com ela dentro seria dizer ao usuario que existe algo para onde se candidatar.
 *
 * Mora num lugar so para que acrescentar um estado novo no futuro nao dependa
 * de achar todas as consultas espalhadas pelos repositorios.
 */
export const OPEN_JOBS: Prisma.JobWhereInput = { closedAt: null };
