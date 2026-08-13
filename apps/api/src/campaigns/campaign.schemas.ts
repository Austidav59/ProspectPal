import { CampaignStatus } from "../generated/prisma";
import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(120)
  .nullish()
  .transform((value) => value || null);

const campaignFields = {
  name: z.string().trim().min(2).max(120),
  country: z.string().trim().min(2).max(100),
  state: optionalText,
  city: z.string().trim().min(2).max(120),
  postalCode: optionalText,
  radiusMeters: z.number().int().min(100).max(50_000).default(25_000),
  niche: z.string().trim().min(2).max(120),
  keyword: optionalText,
  maximumResults: z.number().int().min(1).max(60).default(50),
  minimumRating: z.number().min(0).max(5).nullish().transform((value) => value ?? null),
  minimumReviewCount: z.number().int().nonnegative().nullish().transform((value) => value ?? null),
  maximumReviewCount: z.number().int().nonnegative().nullish().transform((value) => value ?? null),
  includeWithWebsites: z.boolean().default(true),
  includeWithoutWebsites: z.boolean().default(true),
  schedule: optionalText,
};

function validateCampaign(
  campaign: {
    minimumReviewCount?: number | null | undefined;
    maximumReviewCount?: number | null | undefined;
    includeWithWebsites?: boolean | undefined;
    includeWithoutWebsites?: boolean | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (
    campaign.minimumReviewCount !== null &&
    campaign.minimumReviewCount !== undefined &&
    campaign.maximumReviewCount !== null &&
    campaign.maximumReviewCount !== undefined &&
    campaign.minimumReviewCount > campaign.maximumReviewCount
  ) {
    context.addIssue({
      code: "custom",
      message: "Minimum review count cannot exceed maximum review count",
      path: ["minimumReviewCount"],
    });
  }

  if (campaign.includeWithWebsites === false && campaign.includeWithoutWebsites === false) {
    context.addIssue({
      code: "custom",
      message: "At least one website inclusion option must be enabled",
      path: ["includeWithWebsites"],
    });
  }
}

export const createCampaignSchema = z.object(campaignFields).superRefine(validateCampaign);
export const updateCampaignSchema = z
  .object(campaignFields)
  .partial()
  .superRefine(validateCampaign);

export const campaignListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(CampaignStatus).optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>;
