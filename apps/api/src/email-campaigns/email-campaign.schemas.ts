import { z } from "zod";

export const emailOfferTypeSchema = z.enum(["NEED_WEBSITE", "NEED_SEO", "NEED_REVIEWS"]);

export const audiencePreviewQuerySchema = z.object({
  offerType: emailOfferTypeSchema,
  skipAlreadyEmailed: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => {
      if (value === undefined) return true;
      if (typeof value === "boolean") return value;
      return value === "true";
    }),
  searchCampaignId: z.uuid().optional(),
});

export type AudiencePreviewQuery = z.infer<typeof audiencePreviewQuerySchema>;

export const createEmailCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  offerType: emailOfferTypeSchema,
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  skipAlreadyEmailed: z.boolean().optional().default(true),
  searchCampaignId: z.uuid().optional(),
});

export type CreateEmailCampaignInput = z.infer<typeof createEmailCampaignSchema>;

export const emailCampaignListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

export type EmailCampaignListQuery = z.infer<typeof emailCampaignListQuerySchema>;
