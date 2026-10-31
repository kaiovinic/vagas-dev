-- Cache de descricao por URL, independente da vaga ter sido aprovada.
CREATE TABLE "job_descriptions" (
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_descriptions_pkey" PRIMARY KEY ("url")
);

-- Semeia o cache com o que ja esta gravado nas vagas: o que o radar leu uma vez
-- nao precisa ser lido de novo so porque a tabela e nova.
INSERT INTO "job_descriptions" ("url", "description", "fetchedAt")
SELECT DISTINCT ON ("url") "url", "description", "lastSeenAt"
FROM "jobs"
WHERE "description" <> ''
ORDER BY "url", "lastSeenAt" DESC;
