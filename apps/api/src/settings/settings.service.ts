import { Injectable } from "@nestjs/common";
import type { OrganizationSettings } from "../generated/prisma";

import { PrismaService } from "../database/prisma.service";
import type { UpdateSettingsInput } from "./settings.schemas";

export const DEFAULT_DM_TEMPLATE =
  "Hi {name}! I came across your business while researching local companies in your area. " +
  "I help businesses like yours show up higher on Google and turn more visitors into customers. " +
  "I put together a couple of quick, free ideas for your website — mind if I send them over?";

export const DEFAULT_EMAIL_SUBJECT = "A free website idea for {name}";

export const DEFAULT_EMAIL_TEMPLATE =
  "Hi {name},\n\n" +
  "I found your business on Google and noticed you don't have a website yet. " +
  "A simple site helps customers find you, see your reviews, and get in touch — and I'd love to build one for you.\n\n" +
  "I put together a quick, no-obligation mockup of what your site could look like. " +
  "Want me to send it over?\n\n" +
  "Best,\nProspect Pal";

export const DEFAULT_EMAIL_FROM = "Prospect Pal <onboarding@resend.dev>";

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(organizationId: string): Promise<OrganizationSettings> {
    const existing = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
    });
    if (existing) return existing;

    return this.prisma.organizationSettings.upsert({
      where: { organizationId },
      update: {},
      create: {
        organizationId,
        dmDailyLimit: 40,
        dmTemplate: DEFAULT_DM_TEMPLATE,
        emailSubject: DEFAULT_EMAIL_SUBJECT,
        emailTemplate: DEFAULT_EMAIL_TEMPLATE,
        emailFrom: DEFAULT_EMAIL_FROM,
        darkMode: false,
      },
    });
  }

  async update(
    organizationId: string,
    input: UpdateSettingsInput,
  ): Promise<OrganizationSettings> {
    await this.getOrCreate(organizationId);
    const { emailFrom, ...rest } = input;
    return this.prisma.organizationSettings.update({
      where: { organizationId },
      data: {
        ...rest,
        ...(emailFrom !== undefined ? { emailFrom } : {}),
      },
    });
  }
}
