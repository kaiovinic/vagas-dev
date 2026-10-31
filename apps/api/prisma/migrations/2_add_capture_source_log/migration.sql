-- Resultado por fonte dentro de cada captura, para a Saude da Coleta.
-- O capture_logs guarda so o agregado; aqui fica o detalhe de cada coletor.
CREATE TABLE "capture_source_logs" (
    "id" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalFound" INTEGER NOT NULL DEFAULT 0,
    "failed" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,

    CONSTRAINT "capture_source_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "capture_source_logs_source_ranAt_idx" ON "capture_source_logs"("source", "ranAt");
CREATE INDEX "capture_source_logs_ranAt_idx" ON "capture_source_logs"("ranAt");
