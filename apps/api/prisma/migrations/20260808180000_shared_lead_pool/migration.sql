-- Shared lead pool + exclusivity tables

CREATE TABLE IF NOT EXISTS "SharedPlace" (
    "id" UUID NOT NULL,
    "googlePlaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryCategory" TEXT,
    "categories" TEXT[],
    "phone" TEXT,
    "websiteUrl" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "googleMapsUrl" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewCount" INTEGER,
    "businessStatus" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "timesServed" INTEGER NOT NULL DEFAULT 0,
    "lastSeenInSearchAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SharedPlace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SharedPlace_googlePlaceId_key" ON "SharedPlace"("googlePlaceId");
CREATE INDEX IF NOT EXISTS "SharedPlace_marketKey_categoryKey_idx" ON "SharedPlace"("marketKey", "categoryKey");
CREATE INDEX IF NOT EXISTS "SharedPlace_categoryKey_city_idx" ON "SharedPlace"("categoryKey", "city");

CREATE TABLE IF NOT EXISTS "MarketSearchPool" (
    "id" UUID NOT NULL,
    "searchKey" TEXT NOT NULL,
    "marketKey" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "lastRefreshedAt" TIMESTAMP(3),
    "searchExhausted" BOOLEAN NOT NULL DEFAULT false,
    "targetPoolSize" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSearchPool_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketSearchPool_searchKey_key" ON "MarketSearchPool"("searchKey");
CREATE INDEX IF NOT EXISTS "MarketSearchPool_marketKey_categoryKey_idx" ON "MarketSearchPool"("marketKey", "categoryKey");

CREATE TABLE IF NOT EXISTS "MarketTopRanker" (
    "id" UUID NOT NULL,
    "searchKey" TEXT NOT NULL,
    "googlePlaceId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketTopRanker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketTopRanker_searchKey_rank_key" ON "MarketTopRanker"("searchKey", "rank");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketTopRanker_searchKey_googlePlaceId_key" ON "MarketTopRanker"("searchKey", "googlePlaceId");
CREATE INDEX IF NOT EXISTS "MarketTopRanker_googlePlaceId_idx" ON "MarketTopRanker"("googlePlaceId");

CREATE TABLE IF NOT EXISTS "LeadAssignment" (
    "id" UUID NOT NULL,
    "googlePlaceId" TEXT NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cooldownUntil" TIMESTAMP(3) NOT NULL,
    "contactedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeadAssignment_googlePlaceId_cooldownUntil_idx" ON "LeadAssignment"("googlePlaceId", "cooldownUntil");
CREATE INDEX IF NOT EXISTS "LeadAssignment_ownerUserId_cooldownUntil_idx" ON "LeadAssignment"("ownerUserId", "cooldownUntil");
CREATE INDEX IF NOT EXISTS "LeadAssignment_organizationId_cooldownUntil_idx" ON "LeadAssignment"("organizationId", "cooldownUntil");

ALTER TABLE "MarketTopRanker"
  DROP CONSTRAINT IF EXISTS "MarketTopRanker_googlePlaceId_fkey";
ALTER TABLE "MarketTopRanker"
  ADD CONSTRAINT "MarketTopRanker_googlePlaceId_fkey"
  FOREIGN KEY ("googlePlaceId") REFERENCES "SharedPlace"("googlePlaceId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadAssignment"
  DROP CONSTRAINT IF EXISTS "LeadAssignment_googlePlaceId_fkey";
ALTER TABLE "LeadAssignment"
  ADD CONSTRAINT "LeadAssignment_googlePlaceId_fkey"
  FOREIGN KEY ("googlePlaceId") REFERENCES "SharedPlace"("googlePlaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Campaign run ownership + pool messaging
ALTER TABLE "CampaignRun" ADD COLUMN IF NOT EXISTS "ownerUserId" UUID;
ALTER TABLE "CampaignRun" ADD COLUMN IF NOT EXISTS "poolMessage" TEXT;
CREATE INDEX IF NOT EXISTS "CampaignRun_ownerUserId_idx" ON "CampaignRun"("ownerUserId");
