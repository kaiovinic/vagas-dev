-- Rastro de alerta enviado. Sem esta coluna, "ja notificada" so existia como
-- encadeamento de promessas em memoria: um reinicio no meio do despacho perdia
-- o que faltava, e um envio que falhava nunca mais era tentado.
ALTER TABLE "jobs" ADD COLUMN "notifiedAt" TIMESTAMP(3);

-- Tudo que ja esta gravado conta como notificado. Sem este preenchimento, o
-- primeiro despacho depois do deploy dispararia centenas de alertas de vagas
-- antigas de uma vez.
UPDATE "jobs" SET "notifiedAt" = "createdAt";

CREATE INDEX "jobs_notifiedAt_publishedAt_idx" ON "jobs"("notifiedAt", "publishedAt");
