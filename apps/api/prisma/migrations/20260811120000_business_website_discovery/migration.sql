-- Track the website-discovery fallback separately from social-profile search.
ALTER TABLE "Business"
ADD COLUMN IF NOT EXISTS "websiteDiscoveryAttemptedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Business_organizationId_websiteDiscoveryAttemptedAt_idx"
ON "Business"("organizationId", "websiteDiscoveryAttemptedAt");
