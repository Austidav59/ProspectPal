-- CreateEnum
CREATE TYPE "OutreachType" AS ENUM ('DM', 'EMAIL');

-- AlterTable
ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "facebookUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "socialScrapedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dmSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "repliedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dmDailyLimit" INTEGER NOT NULL DEFAULT 40,
    "dmTemplate" TEXT NOT NULL,
    "emailSubject" TEXT NOT NULL,
    "emailTemplate" TEXT NOT NULL,
    "emailFrom" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "type" "OutreachType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");

-- CreateIndex
CREATE INDEX "OutreachEvent_organizationId_type_createdAt_idx" ON "OutreachEvent"("organizationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "OutreachEvent_businessId_idx" ON "OutreachEvent"("businessId");

-- AddForeignKey
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
