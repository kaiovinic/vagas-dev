-- Vaga encerrada na fonte: a issue do GitHub foi fechada.
-- Nulo significa aberta; o feed e as metricas contam so o que esta nulo.
-- A coluna e nulavel de proposito, para a data do encerramento ficar
-- registrada em vez de um booleano que nao diz quando.
ALTER TABLE "jobs" ADD COLUMN "closedAt" TIMESTAMP(3);

-- O feed pergunta sempre "aberta e dentro da janela", nessa ordem.
CREATE INDEX "jobs_closedAt_publishedAt_idx" ON "jobs"("closedAt", "publishedAt");
