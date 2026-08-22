import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Prefer Render's PORT when present; otherwise API_PORT / default 3000. */
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().url(),
    DATABASE_URL: z.string().min(1),
    AUTH0_DOMAIN: z.string().min(1),
    AUTH0_AUDIENCE: z.string().min(1),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    /** mock = fake local leads; maps = self-hosted gosom Google Maps scraper. */
    BUSINESS_DISCOVERY_PROVIDER: z.enum(["mock", "maps"]).default("mock"),
    /** Base URL for gosom/google-maps-scraper web UI/API (no trailing slash). */
    MAPS_SCRAPER_URL: optionalUrl,
    /** Optional proxy list, comma or newline separated (socks5:// / http:// / https://). */
    MAPS_SCRAPER_PROXIES: optionalNonEmptyString,
    /** Scroll depth for Maps results (approx 20 listings per depth). */
    MAPS_SCRAPER_DEPTH: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.coerce.number().int().positive().max(20).optional(),
    ),
    /** Job max runtime in seconds (gosom API multiplies this by seconds). Min ~180. */
    MAPS_SCRAPER_MAX_TIME_SECONDS: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.coerce.number().int().min(180).default(600),
    ),
    /** OAuth client for connecting personal Gmail inboxes (send outreach). */
    GOOGLE_GMAIL_CLIENT_ID: optionalNonEmptyString,
    GOOGLE_GMAIL_CLIENT_SECRET: optionalNonEmptyString,
    GOOGLE_GMAIL_REDIRECT_URI: optionalUrl,
    /** Resend API key for email campaign blasts. */
    RESEND_API_KEY: optionalNonEmptyString,
    /** Verified Resend from address, e.g. "Prospect Pal <hello@yourdomain.com>". */
    RESEND_FROM_EMAIL: optionalNonEmptyString,
  })
  .superRefine((environment, context) => {
    if (environment.BUSINESS_DISCOVERY_PROVIDER === "maps" && !environment.MAPS_SCRAPER_URL) {
      context.addIssue({
        code: "custom",
        message: "MAPS_SCRAPER_URL is required when BUSINESS_DISCOVERY_PROVIDER=maps",
        path: ["MAPS_SCRAPER_URL"],
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

/**
 * Incomplete Gmail OAuth triples are cleared instead of crashing boot.
 * GmailService already treats missing config as "not configured".
 */
function normalizeGmailConfig(values: Record<string, unknown>): Record<string, unknown> {
  const id =
    typeof values.GOOGLE_GMAIL_CLIENT_ID === "string" ? values.GOOGLE_GMAIL_CLIENT_ID.trim() : "";
  const secret =
    typeof values.GOOGLE_GMAIL_CLIENT_SECRET === "string"
      ? values.GOOGLE_GMAIL_CLIENT_SECRET.trim()
      : "";
  const redirect =
    typeof values.GOOGLE_GMAIL_REDIRECT_URI === "string"
      ? values.GOOGLE_GMAIL_REDIRECT_URI.trim()
      : "";
  const setCount = [id, secret, redirect].filter(Boolean).length;
  if (setCount === 0 || setCount === 3) {
    return values;
  }
  return {
    ...values,
    GOOGLE_GMAIL_CLIENT_ID: undefined,
    GOOGLE_GMAIL_CLIENT_SECRET: undefined,
    GOOGLE_GMAIL_REDIRECT_URI: undefined,
  };
}

export function validateEnvironment(values: Record<string, unknown>): Environment {
  const port = values.PORT ?? values.API_PORT;
  const normalized = normalizeGmailConfig({
    ...values,
    ...(port !== undefined && port !== "" ? { API_PORT: port } : {}),
  });
  return environmentSchema.parse(normalized);
}
