-- Historico dos curriculos gerados, preso a vaga que o originou.
CREATE TABLE "generated_resumes" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "rationale" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gaps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_resumes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generated_resumes_jobId_createdAt_idx" ON "generated_resumes"("jobId", "createdAt");

ALTER TABLE "generated_resumes" ADD CONSTRAINT "generated_resumes_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
