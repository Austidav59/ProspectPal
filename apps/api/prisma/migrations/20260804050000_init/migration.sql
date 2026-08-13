CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SALES_REP', 'ANALYST');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "CampaignRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "SearchSource" AS ENUM ('GOOGLE_PLACES', 'MOCK');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Organization" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "subscriptionStatus" TEXT NOT NULL DEFAULT 'internal',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationUser" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "UserRole" NOT NULL,
  CONSTRAINT "OrganizationUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefreshSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchCampaign" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "state" TEXT,
  "city" TEXT NOT NULL,
  "postalCode" TEXT,
  "radiusMeters" INTEGER NOT NULL DEFAULT 25000,
  "niche" TEXT NOT NULL,
  "keyword" TEXT,
  "maximumResults" INTEGER NOT NULL DEFAULT 50,
  "minimumRating" DOUBLE PRECISION,
  "minimumReviewCount" INTEGER,
  "maximumReviewCount" INTEGER,
  "includeWithWebsites" BOOLEAN NOT NULL DEFAULT true,
  "includeWithoutWebsites" BOOLEAN NOT NULL DEFAULT true,
  "schedule" TEXT,
  "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignRun" (
  "id" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "status" "CampaignRunStatus" NOT NULL DEFAULT 'QUEUED',
  "source" "SearchSource" NOT NULL,
  "discoveredCount" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "filteredCount" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Business" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "googlePlaceId" TEXT NOT NULL,
  "externalProviderId" TEXT NOT NULL,
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
  "priceLevel" TEXT,
  "regularOpeningHours" JSONB,
  "currentOpeningHours" JSONB,
  "photoReferences" JSONB,
  "description" TEXT,
  "searchSource" "SearchSource" NOT NULL,
  "searchCity" TEXT NOT NULL,
  "searchNiche" TEXT NOT NULL,
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessDiscovery" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "rawData" JSONB NOT NULL,
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessDiscovery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscoveryJob" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "availableAt" TIMESTAMP(3) NOT NULL,
  "lockedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscoveryJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "OrganizationUser_organizationId_userId_key" ON "OrganizationUser"("organizationId", "userId");
CREATE INDEX "OrganizationUser_userId_idx" ON "OrganizationUser"("userId");
CREATE INDEX "RefreshSession_userId_idx" ON "RefreshSession"("userId");
CREATE INDEX "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");
CREATE INDEX "SearchCampaign_organizationId_status_idx" ON "SearchCampaign"("organizationId", "status");
CREATE INDEX "CampaignRun_campaignId_createdAt_idx" ON "CampaignRun"("campaignId", "createdAt");
CREATE INDEX "CampaignRun_status_idx" ON "CampaignRun"("status");
CREATE UNIQUE INDEX "Business_organizationId_googlePlaceId_key" ON "Business"("organizationId", "googlePlaceId");
CREATE INDEX "Business_organizationId_name_idx" ON "Business"("organizationId", "name");
CREATE INDEX "Business_organizationId_phone_idx" ON "Business"("organizationId", "phone");
CREATE INDEX "Business_organizationId_websiteUrl_idx" ON "Business"("organizationId", "websiteUrl");
CREATE UNIQUE INDEX "BusinessDiscovery_runId_businessId_key" ON "BusinessDiscovery"("runId", "businessId");
CREATE INDEX "BusinessDiscovery_businessId_idx" ON "BusinessDiscovery"("businessId");
CREATE UNIQUE INDEX "DiscoveryJob_runId_key" ON "DiscoveryJob"("runId");
CREATE INDEX "DiscoveryJob_status_availableAt_idx" ON "DiscoveryJob"("status", "availableAt");

ALTER TABLE "OrganizationUser"
  ADD CONSTRAINT "OrganizationUser_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationUser"
  ADD CONSTRAINT "OrganizationUser_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RefreshSession"
  ADD CONSTRAINT "RefreshSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SearchCampaign"
  ADD CONSTRAINT "SearchCampaign_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampaignRun"
  ADD CONSTRAINT "CampaignRun_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "SearchCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Business"
  ADD CONSTRAINT "Business_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessDiscovery"
  ADD CONSTRAINT "BusinessDiscovery_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "CampaignRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessDiscovery"
  ADD CONSTRAINT "BusinessDiscovery_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveryJob"
  ADD CONSTRAINT "DiscoveryJob_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "CampaignRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
