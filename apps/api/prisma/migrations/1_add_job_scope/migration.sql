-- CreateEnum
CREATE TYPE "public"."JobScope" AS ENUM ('NATIONAL', 'INTERNATIONAL', 'UNKNOWN');

-- AlterTable
ALTER TABLE "public"."jobs" ADD COLUMN     "scope" "public"."JobScope" NOT NULL DEFAULT 'UNKNOWN';

-- CreateIndex
CREATE INDEX "jobs_scope_publishedAt_idx" ON "public"."jobs"("scope", "publishedAt");

