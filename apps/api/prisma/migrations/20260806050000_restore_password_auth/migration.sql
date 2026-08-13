-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "RefreshSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RefreshSession_userId_idx" ON "RefreshSession"("userId");
CREATE INDEX IF NOT EXISTS "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RefreshSession_userId_fkey'
  ) THEN
    ALTER TABLE "RefreshSession"
      ADD CONSTRAINT "RefreshSession_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
