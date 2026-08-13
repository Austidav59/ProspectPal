-- Hot-path indexes for leads list, outreach filters, and enrichment catch-up.
CREATE INDEX IF NOT EXISTS "Business_organizationId_dmSentAt_idx"
  ON "Business"("organizationId", "dmSentAt");

CREATE INDEX IF NOT EXISTS "Business_organizationId_emailSentAt_idx"
  ON "Business"("organizationId", "emailSentAt");

CREATE INDEX IF NOT EXISTS "Business_organizationId_instagramScrapedAt_idx"
  ON "Business"("organizationId", "instagramScrapedAt");

CREATE INDEX IF NOT EXISTS "Business_organizationId_googleSearchAttemptedAt_idx"
  ON "Business"("organizationId", "googleSearchAttemptedAt");

CREATE INDEX IF NOT EXISTS "Business_organizationId_rating_reviewCount_idx"
  ON "Business"("organizationId", "rating", "reviewCount");

-- Partial indexes keep enrichment catch-up and contactable filters cheap as the table grows.
CREATE INDEX IF NOT EXISTS "Business_org_needs_website_scan_idx"
  ON "Business" ("organizationId", "discoveredAt" DESC)
  WHERE "websiteUrl" IS NOT NULL AND "instagramScrapedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Business_org_needs_google_search_idx"
  ON "Business" ("organizationId", "discoveredAt" DESC)
  WHERE "instagramUrl" IS NULL AND "googleSearchAttemptedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Business_org_has_instagram_idx"
  ON "Business" ("organizationId")
  WHERE "instagramUrl" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Business_org_has_email_idx"
  ON "Business" ("organizationId")
  WHERE "email" IS NOT NULL;
