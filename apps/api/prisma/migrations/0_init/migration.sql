-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."PublishedAtSource" AS ENUM ('SOURCE', 'CAPTURE');

-- CreateEnum
CREATE TYPE "public"."JobWorkModel" AS ENUM ('REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."CaptureStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "public"."jobs" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "recruiterName" TEXT,
    "city" TEXT,
    "isRemote" BOOLEAN NOT NULL DEFAULT false,
    "workModel" "public"."JobWorkModel" NOT NULL DEFAULT 'UNKNOWN',
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "publishedAtSource" "public"."PublishedAtSource" NOT NULL DEFAULT 'SOURCE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."capture_logs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "public"."CaptureStatus" NOT NULL DEFAULT 'RUNNING',
    "nextRunAt" TIMESTAMP(3),
    "totalFound" INTEGER NOT NULL DEFAULT 0,
    "totalApproved" INTEGER NOT NULL DEFAULT 0,
    "totalRejected" INTEGER NOT NULL DEFAULT 0,
    "totalDuplicated" INTEGER NOT NULL DEFAULT 0,
    "totalPersisted" INTEGER NOT NULL DEFAULT 0,
    "failedSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorMessage" TEXT,

    CONSTRAINT "capture_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_fingerprint_key" ON "public"."jobs"("fingerprint");

-- CreateIndex
CREATE INDEX "jobs_publishedAt_idx" ON "public"."jobs"("publishedAt");

-- CreateIndex
CREATE INDEX "jobs_source_publishedAt_idx" ON "public"."jobs"("source", "publishedAt");

-- CreateIndex
CREATE INDEX "jobs_isRemote_publishedAt_idx" ON "public"."jobs"("isRemote", "publishedAt");

-- CreateIndex
CREATE INDEX "jobs_company_idx" ON "public"."jobs"("company");

-- CreateIndex
CREATE INDEX "capture_logs_startedAt_idx" ON "public"."capture_logs"("startedAt");

-- CreateIndex
CREATE INDEX "capture_logs_status_startedAt_idx" ON "public"."capture_logs"("status", "startedAt");

