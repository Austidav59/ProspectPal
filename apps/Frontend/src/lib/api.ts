import { z } from "zod";

const apiUrl =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "http://localhost:3000/api" : "/api");

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  organizationId: z.uuid(),
  role: z.enum(["ADMIN", "SALES_REP", "ANALYST"]),
});

export type AppUser = z.infer<typeof userSchema>;

function extractErrorMessage(payload: unknown, fallback: string): string {
  return typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
    ? payload.message
    : fallback;
}

async function request<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(
      extractErrorMessage(payload, `Request failed (${response.status})`),
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function fetchCurrentUser(accessToken: string): Promise<AppUser> {
  const response = await fetch(`${apiUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(
      extractErrorMessage(payload, "Unable to load your workspace profile"),
    );
  }

  return userSchema.parse(await response.json());
}

export const campaignRunSchema = z.object({
  id: z.uuid(),
  status: z.enum(["QUEUED", "RUNNING", "COMPLETED", "FAILED"]),
  discoveredCount: z.number(),
  createdCount: z.number(),
  updatedCount: z.number(),
  errorMessage: z.string().nullable(),
  poolMessage: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const campaignSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  niche: z.string(),
  city: z.string(),
  state: z.string().nullable(),
  country: z.string(),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]),
  createdAt: z.string(),
  runs: z.array(campaignRunSchema).optional(),
});

export type Campaign = z.infer<typeof campaignSchema>;

export const businessSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  primaryCategory: z.string().nullable(),
  phone: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  websiteDiscoveryAttemptedAt: z.string().nullable(),
  instagramUrl: z.string().nullable(),
  instagramScrapedAt: z.string().nullable(),
  facebookUrl: z.string().nullable(),
  email: z.string().nullable(),
  socialScrapedAt: z.string().nullable(),
  googleSearchAttemptedAt: z.string().nullable(),
  dmSentAt: z.string().nullable(),
  emailSentAt: z.string().nullable(),
  repliedAt: z.string().nullable(),
  address: z.string(),
  city: z.string(),
  state: z.string().nullable(),
  googleMapsUrl: z.string().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  receptivenessScore: z.number().optional(),
  receptivenessLabel: z.string().optional(),
  receptivenessReasons: z.array(z.string()).optional(),
  isTopGoogleRanker: z.boolean().optional(),
  googleRank: z.number().nullable().optional(),
});

export type Business = z.infer<typeof businessSchema>;

function paginated<Schema extends z.ZodType>(itemSchema: Schema) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  });
}

export interface CreateCampaignPayload {
  name: string;
  niche: string;
  city: string;
  state: string | null;
  country: string;
  maximumResults: number;
}

export async function createCampaign(
  accessToken: string,
  payload: CreateCampaignPayload,
): Promise<Campaign> {
  const body = await request<unknown>("/campaigns", accessToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return campaignSchema.parse(body);
}

export async function runCampaign(
  accessToken: string,
  campaignId: string,
): Promise<void> {
  await request<unknown>(`/campaigns/${campaignId}/run`, accessToken, {
    method: "POST",
  });
}

/** Soft-remove from Recent searches. Keeps campaign + shared pool leads in the database. */
export async function deleteCampaign(
  accessToken: string,
  campaignId: string,
): Promise<void> {
  await request<unknown>(`/campaigns/${campaignId}`, accessToken, {
    method: "DELETE",
  });
}

/** Hide from Recent searches (paused). Shared pool data is unchanged. */
export async function hideCampaign(
  accessToken: string,
  campaignId: string,
): Promise<void> {
  await request<unknown>(`/campaigns/${campaignId}/pause`, accessToken, {
    method: "POST",
  });
}

/** Restore a hidden search to Recent searches. */
export async function unhideCampaign(
  accessToken: string,
  campaignId: string,
): Promise<Campaign> {
  const body = await request<unknown>(
    `/campaigns/${campaignId}/unhide`,
    accessToken,
    {
      method: "POST",
    },
  );
  return campaignSchema.parse(body);
}

export async function listCampaigns(
  accessToken: string,
  params: { status?: "ACTIVE" | "PAUSED" | "ARCHIVED" } = {},
) {
  const query = new URLSearchParams({ pageSize: "50" });
  if (params.status) query.set("status", params.status);
  const body = await request<unknown>(
    `/campaigns?${query.toString()}`,
    accessToken,
  );
  return paginated(campaignSchema).parse(body);
}

export interface BusinessListParams {
  page?: number | undefined;
  search?: string | undefined;
  campaignId?: string | undefined;
  hasWebsite?: boolean | undefined;
  contacted?: boolean | undefined;
  contactableOnly?: boolean | undefined;
}

export async function listBusinesses(
  accessToken: string,
  params: BusinessListParams = {},
) {
  const query = new URLSearchParams({ pageSize: "50" });
  if (params.page) query.set("page", String(params.page));
  if (params.search) query.set("search", params.search);
  if (params.campaignId) query.set("campaignId", params.campaignId);
  if (params.hasWebsite !== undefined)
    query.set("hasWebsite", String(params.hasWebsite));
  if (params.contacted !== undefined)
    query.set("contacted", String(params.contacted));
  if (params.contactableOnly !== undefined) {
    query.set("contactableOnly", String(params.contactableOnly));
  }

  const body = await request<unknown>(
    `/businesses?${query.toString()}`,
    accessToken,
  );
  return paginated(businessSchema).parse(body);
}

export async function scrapeInstagram(
  accessToken: string,
  businessId: string,
): Promise<Business> {
  const body = await request<unknown>(
    `/businesses/${businessId}/scrape-instagram`,
    accessToken,
    {
      method: "POST",
    },
  );
  return businessSchema.parse(body);
}

export async function findSocials(
  accessToken: string,
  businessId: string,
): Promise<Business> {
  const body = await request<unknown>(
    `/businesses/${businessId}/find-socials`,
    accessToken,
    {
      method: "POST",
    },
  );
  return businessSchema.parse(body);
}

export async function updateBusiness(
  accessToken: string,
  businessId: string,
  payload: Partial<{
    email: string | null;
    instagramUrl: string | null;
    facebookUrl: string | null;
  }>,
): Promise<Business> {
  const body = await request<unknown>(
    `/businesses/${businessId}`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  return businessSchema.parse(body);
}

export function localDayStartIso(): string {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return dayStart.toISOString();
}

export const outreachSummarySchema = z.object({
  dmsToday: z.number(),
  emailsToday: z.number(),
  dmDailyLimit: z.number(),
});

export type OutreachSummary = z.infer<typeof outreachSummarySchema>;

export async function fetchOutreachSummary(
  accessToken: string,
): Promise<OutreachSummary> {
  const body = await request<unknown>(
    `/outreach/summary?dayStart=${encodeURIComponent(localDayStartIso())}`,
    accessToken,
  );
  return outreachSummarySchema.parse(body);
}

export async function markDmSent(
  accessToken: string,
  businessId: string,
): Promise<Business> {
  const body = await request<unknown>(
    `/businesses/${businessId}/mark-dm`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ dayStart: localDayStartIso() }),
    },
  );
  return businessSchema.parse(body);
}

export async function sendOfferEmail(
  accessToken: string,
  businessId: string,
): Promise<Business> {
  const body = await request<unknown>(
    `/businesses/${businessId}/send-email`,
    accessToken,
    {
      method: "POST",
    },
  );
  return businessSchema.parse(body);
}

export const gmailStatusSchema = z.object({
  connected: z.boolean(),
  email: z.string().nullable(),
  connectedAt: z.string().nullable(),
  configured: z.boolean(),
});

export type GmailStatus = z.infer<typeof gmailStatusSchema>;

export async function fetchGmailStatus(
  accessToken: string,
): Promise<GmailStatus> {
  const body = await request<unknown>("/email/gmail/status", accessToken);
  return gmailStatusSchema.parse(body);
}

export async function startGmailConnect(
  accessToken: string,
): Promise<{ url: string }> {
  const body = await request<unknown>("/email/gmail/connect", accessToken);
  return z.object({ url: z.string().url() }).parse(body);
}

export async function disconnectGmail(
  accessToken: string,
): Promise<GmailStatus> {
  const body = await request<unknown>("/email/gmail/disconnect", accessToken, {
    method: "DELETE",
  });
  return gmailStatusSchema.parse(body);
}

export const settingsSchema = z.object({
  dmDailyLimit: z.number(),
  dmTemplate: z.string(),
  emailSubject: z.string(),
  emailTemplate: z.string(),
  emailFrom: z.string().optional().default("Prospect Pal"),
  darkMode: z.boolean().default(false),
});

export type Settings = z.infer<typeof settingsSchema>;

export async function fetchSettings(accessToken: string): Promise<Settings> {
  const body = await request<unknown>("/settings", accessToken);
  return settingsSchema.parse(body);
}

export async function updateSettings(
  accessToken: string,
  payload: Settings,
): Promise<Settings> {
  const body = await request<unknown>("/settings", accessToken, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return settingsSchema.parse(body);
}

export const emailOfferTypeSchema = z.enum([
  "NEED_WEBSITE",
  "NEED_SEO",
  "NEED_REVIEWS",
]);

export type EmailOfferType = z.infer<typeof emailOfferTypeSchema>;

export const emailCampaignSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  offerType: emailOfferTypeSchema,
  subject: z.string(),
  body: z.string(),
  status: z.enum(["DRAFT", "SENDING", "COMPLETED", "FAILED", "CANCELLED"]),
  audienceCount: z.number(),
  sentCount: z.number(),
  failedCount: z.number(),
  skipAlreadyEmailed: z.boolean(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});

export type EmailCampaign = z.infer<typeof emailCampaignSchema>;

export const emailCampaignTemplateSchema = z.object({
  offerType: emailOfferTypeSchema,
  label: z.string(),
  description: z.string(),
  defaultName: z.string(),
  subject: z.string(),
  body: z.string(),
});

export type EmailCampaignTemplate = z.infer<typeof emailCampaignTemplateSchema>;

export const emailCampaignAudienceSchema = z.object({
  total: z.number(),
  offerType: emailOfferTypeSchema,
  sample: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string().nullable(),
      websiteUrl: z.string().nullable(),
      city: z.string(),
      rating: z.number().nullable(),
      reviewCount: z.number().nullable(),
      emailSentAt: z.string().nullable(),
    }),
  ),
});

export async function fetchEmailCampaignStatus(accessToken: string) {
  const body = await request<unknown>("/email-campaigns/status", accessToken);
  return z
    .object({
      configured: z.boolean(),
      defaultFrom: z.string().nullable(),
    })
    .parse(body);
}

export async function fetchEmailCampaignTemplates(accessToken: string) {
  const body = await request<unknown>("/email-campaigns/templates", accessToken);
  return z.array(emailCampaignTemplateSchema).parse(body);
}

export async function previewEmailCampaignAudience(
  accessToken: string,
  params: {
    offerType: EmailOfferType;
    skipAlreadyEmailed?: boolean;
    searchCampaignId?: string;
  },
) {
  const query = new URLSearchParams({
    offerType: params.offerType,
    skipAlreadyEmailed: String(params.skipAlreadyEmailed ?? true),
  });
  if (params.searchCampaignId) {
    query.set("searchCampaignId", params.searchCampaignId);
  }
  const body = await request<unknown>(
    `/email-campaigns/audience?${query.toString()}`,
    accessToken,
  );
  return emailCampaignAudienceSchema.parse(body);
}

export async function listEmailCampaigns(accessToken: string) {
  const body = await request<unknown>(
    "/email-campaigns?pageSize=20",
    accessToken,
  );
  return paginated(emailCampaignSchema).parse(body);
}

export async function createEmailCampaign(
  accessToken: string,
  payload: {
    name: string;
    offerType: EmailOfferType;
    subject: string;
    body: string;
    skipAlreadyEmailed?: boolean;
    searchCampaignId?: string;
  },
): Promise<EmailCampaign> {
  const body = await request<unknown>("/email-campaigns", accessToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return emailCampaignSchema.parse(body);
}

export async function startEmailCampaign(
  accessToken: string,
  campaignId: string,
): Promise<EmailCampaign> {
  const body = await request<unknown>(
    `/email-campaigns/${campaignId}/start`,
    accessToken,
    { method: "POST" },
  );
  return emailCampaignSchema.parse(body);
}

export async function getEmailCampaign(
  accessToken: string,
  campaignId: string,
) {
  const body = await request<unknown>(
    `/email-campaigns/${campaignId}`,
    accessToken,
  );
  return emailCampaignSchema
    .extend({
      sends: z
        .array(
          z.object({
            id: z.uuid(),
            toEmail: z.string(),
            status: z.enum(["PENDING", "SENT", "FAILED", "SKIPPED"]),
            errorMessage: z.string().nullable(),
            sentAt: z.string().nullable(),
            business: z.object({
              id: z.uuid(),
              name: z.string(),
              email: z.string().nullable(),
              city: z.string(),
            }),
          }),
        )
        .optional(),
    })
    .parse(body);
}

