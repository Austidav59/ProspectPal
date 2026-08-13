-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN IF NOT EXISTS "darkMode" BOOLEAN NOT NULL DEFAULT false;
