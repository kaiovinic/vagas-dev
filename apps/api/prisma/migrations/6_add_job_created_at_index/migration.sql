-- A volumetria de captura do dashboard filtra pela data de ingestao em blocos de
-- 2 horas; sem este indice cada bloco varreria a tabela inteira.
CREATE INDEX "jobs_createdAt_idx" ON "jobs"("createdAt");
