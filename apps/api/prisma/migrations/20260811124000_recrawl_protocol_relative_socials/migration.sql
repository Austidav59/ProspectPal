-- Requeue sites whose protocol-relative/profile.php Facebook links were previously missed.
UPDATE "Business"
SET
  "instagramScrapedAt" = NULL,
  "socialScrapedAt" = NULL
WHERE
  "websiteUrl" IS NOT NULL
  AND "instagramUrl" IS NULL
  AND "facebookUrl" IS NULL;
