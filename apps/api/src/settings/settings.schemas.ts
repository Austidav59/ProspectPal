import { z } from "zod";

export const updateSettingsSchema = z.object({
  dmDailyLimit: z.number().int().min(1).max(500),
  dmTemplate: z.string().trim().min(1).max(2_000),
  emailSubject: z.string().trim().min(1).max(200),
  emailTemplate: z.string().trim().min(1).max(5_000),
  /** Kept for backward compatibility; outreach sends from the connected Gmail inbox. */
  emailFrom: z.string().trim().min(3).max(200).optional(),
  darkMode: z.boolean(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
