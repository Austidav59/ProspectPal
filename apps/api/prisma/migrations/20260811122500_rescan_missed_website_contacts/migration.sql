-- Requeue websites scanned before contact/about-page extraction was added.
UPDATE "Business"
SET
  "instagramScrapedAt" = NULL,
  "socialScrapedAt" = NULL
WHERE
  "websiteUrl" IS NOT NULL
  AND "instagramUrl" IS NULL
  AND "facebookUrl" IS NULL
  AND "email" IS NULL;
