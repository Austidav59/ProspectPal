-- Requeue unresolved websites for the expanded multi-page crawler.
UPDATE "Business"
SET
  "instagramScrapedAt" = NULL,
  "socialScrapedAt" = NULL
WHERE
  "websiteUrl" IS NOT NULL
  AND "instagramUrl" IS NULL
  AND "facebookUrl" IS NULL
  AND "email" IS NULL;
