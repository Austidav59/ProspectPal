import { z } from "zod";

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().url(),
    DATABASE_URL: z.string().min(1),
    AUTH0_DOMAIN: z.string().min(1),
    AUTH0_AUDIENCE: z.string().min(1),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    BUSINESS_DISCOVERY_PROVIDER: z.enum(["mock", "google"]).default("mock"),
    GOOGLE_PLACES_API_KEY: z.string().min(1).optional(),
    /** OAuth client for connecting personal Gmail inboxes (send outreach). */
    GOOGLE_GMAIL_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_GMAIL_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_GMAIL_REDIRECT_URI: z.string().url().optional(),
    /** Resend API key for email campaign blasts. */
    RESEND_API_KEY: z.string().min(1).optional(),
    /** Verified Resend from address, e.g. "Prospect Pal <hello@yourdomain.com>". */
    RESEND_FROM_EMAIL: z.string().min(1).optional(),
  })
  .superRefine((environment, context) => {
    if (environment.BUSINESS_DISCOVERY_PROVIDER === "google" && !environment.GOOGLE_PLACES_API_KEY) {
      context.addIssue({
        code: "custom",
        message: "GOOGLE_PLACES_API_KEY is required when the Google discovery provider is enabled",
        path: ["GOOGLE_PLACES_API_KEY"],
      });
    }

    const gmailBits = [
      environment.GOOGLE_GMAIL_CLIENT_ID,
      environment.GOOGLE_GMAIL_CLIENT_SECRET,
      environment.GOOGLE_GMAIL_REDIRECT_URI,
    ];
    const gmailSet = gmailBits.filter(Boolean).length;
    if (gmailSet > 0 && gmailSet < 3) {
      context.addIssue({
        code: "custom",
        message:
          "GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, and GOOGLE_GMAIL_REDIRECT_URI must all be set together",
        path: ["GOOGLE_GMAIL_CLIENT_ID"],
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(values: Record<string, unknown>): Environment {
  return environmentSchema.parse(values);
}
