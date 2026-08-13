import { z } from "zod";

export const businessListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  campaignId: z.uuid().optional(),
  hasWebsite: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  contacted: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  // Default true in the service when omitted from the query would surprise API
  // clients — so the portal always passes this explicitly.
  contactableOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const updateBusinessSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    primaryCategory: z.string().trim().max(120).nullable(),
    categories: z.array(z.string().trim().min(1).max(120)).max(25),
    phone: z.string().trim().max(40).nullable(),
    websiteUrl: z.url().nullable(),
    instagramUrl: z.url().nullable(),
    facebookUrl: z.url().nullable(),
    email: z.email().nullable(),
    address: z.string().trim().min(1).max(300),
    googleMapsUrl: z.url().nullable(),
  })
  .partial();

export const markDmSchema = z.object({
  // Start of "today" in the user's timezone, so the daily counter resets at
  // their midnight rather than the server's.
  dayStart: z.iso.datetime(),
});

export const outreachSummaryQuerySchema = z.object({
  dayStart: z.iso.datetime(),
});

export const setRepliedSchema = z.object({
  replied: z.boolean(),
});

export type BusinessListQuery = z.infer<typeof businessListQuerySchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
export type MarkDmInput = z.infer<typeof markDmSchema>;
export type OutreachSummaryQuery = z.infer<typeof outreachSummaryQuerySchema>;
export type SetRepliedInput = z.infer<typeof setRepliedSchema>;
