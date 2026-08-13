import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  EmailCampaignStatus,
  EmailOfferType,
  EmailSendStatus,
  OutreachType,
  type Business,
  type EmailCampaign,
  type Prisma,
} from "../generated/prisma";

import { PrismaService } from "../database/prisma.service";
import { ResendService } from "../email/resend.service";
import { LeadPoolService } from "../leads/lead-pool.service";
import { SettingsService } from "../settings/settings.service";
import type {
  AudiencePreviewQuery,
  CreateEmailCampaignInput,
  EmailCampaignListQuery,
} from "./email-campaign.schemas";
import { fillTemplate, OFFER_TEMPLATES } from "./email-campaign.templates";

const MAX_SENDS_PER_CAMPAIGN = 100;
const SEND_DELAY_MS = 350;

@Injectable()
export class EmailCampaignsService {
  private readonly logger = new Logger(EmailCampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
    private readonly settings: SettingsService,
    private readonly leadPool: LeadPoolService,
  ) {}

  templates() {
    return Object.entries(OFFER_TEMPLATES).map(([offerType, template]) => ({
      offerType: offerType as EmailOfferType,
      ...template,
    }));
  }

  status() {
    return {
      configured: this.resend.isConfigured(),
      defaultFrom: this.resend.getDefaultFrom(),
    };
  }

  async previewAudience(organizationId: string, query: AudiencePreviewQuery) {
    const where = this.audienceWhere(organizationId, query.offerType, {
      skipAlreadyEmailed: query.skipAlreadyEmailed,
      ...(query.searchCampaignId ? { searchCampaignId: query.searchCampaignId } : {}),
    });
    const [total, sample] = await Promise.all([
      this.prisma.business.count({ where }),
      this.prisma.business.findMany({
        where,
        orderBy: [{ discoveredAt: "desc" }],
        take: 8,
        select: {
          id: true,
          name: true,
          email: true,
          websiteUrl: true,
          city: true,
          rating: true,
          reviewCount: true,
          emailSentAt: true,
        },
      }),
    ]);
    return { total, sample, offerType: query.offerType };
  }

  async list(organizationId: string, query: EmailCampaignListQuery) {
    const where = { organizationId };
    const [total, items] = await Promise.all([
      this.prisma.emailCampaign.count({ where }),
      this.prisma.emailCampaign.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(organizationId: string, id: string) {
    const campaign = await this.prisma.emailCampaign.findFirst({
      where: { id, organizationId },
      include: {
        sends: {
          orderBy: { createdAt: "asc" },
          take: 200,
          include: {
            business: {
              select: { id: true, name: true, email: true, city: true },
            },
          },
        },
      },
    });
    if (!campaign) throw new NotFoundException("Email campaign was not found");
    return campaign;
  }

  async create(
    organizationId: string,
    input: CreateEmailCampaignInput,
  ): Promise<EmailCampaign> {
    const audience = await this.prisma.business.findMany({
      where: this.audienceWhere(organizationId, input.offerType, {
        skipAlreadyEmailed: input.skipAlreadyEmailed,
        ...(input.searchCampaignId ? { searchCampaignId: input.searchCampaignId } : {}),
      }),
      orderBy: [{ discoveredAt: "desc" }],
      take: MAX_SENDS_PER_CAMPAIGN,
      select: { id: true, email: true },
    });

    if (audience.length === 0) {
      throw new BadRequestException(
        "No stored leads match this offer yet. Find businesses first, then wait for enrichment to save emails.",
      );
    }

    return this.prisma.emailCampaign.create({
      data: {
        organizationId,
        name: input.name,
        offerType: input.offerType,
        subject: input.subject,
        body: input.body,
        skipAlreadyEmailed: input.skipAlreadyEmailed,
        status: EmailCampaignStatus.DRAFT,
        audienceCount: audience.length,
        sends: {
          create: audience
            .filter((lead): lead is { id: string; email: string } => Boolean(lead.email))
            .map((lead) => ({
              businessId: lead.id,
              toEmail: lead.email,
              status: EmailSendStatus.PENDING,
            })),
        },
      },
    });
  }

  async start(
    organizationId: string,
    ownerUserId: string,
    campaignId: string,
  ): Promise<EmailCampaign> {
    if (!this.resend.isConfigured()) {
      throw new ServiceUnavailableException(
        "RESEND_API_KEY is not configured. Add it to your environment to send campaigns.",
      );
    }

    const campaign = await this.prisma.emailCampaign.findFirst({
      where: { id: campaignId, organizationId },
      include: { sends: { where: { status: EmailSendStatus.PENDING } } },
    });
    if (!campaign) throw new NotFoundException("Email campaign was not found");
    if (campaign.status === EmailCampaignStatus.SENDING) {
      throw new BadRequestException("This campaign is already sending");
    }
    if (
      campaign.status === EmailCampaignStatus.COMPLETED ||
      campaign.status === EmailCampaignStatus.CANCELLED
    ) {
      throw new BadRequestException("This campaign has already finished");
    }
    if (campaign.sends.length === 0) {
      throw new BadRequestException("This campaign has no pending recipients");
    }

    const settings = await this.settings.getOrCreate(organizationId);
    const from =
      this.resend.getDefaultFrom() ??
      settings.emailFrom ??
      "Prospect Pal <onboarding@resend.dev>";

    await this.prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: {
        status: EmailCampaignStatus.SENDING,
        startedAt: new Date(),
        errorMessage: null,
      },
    });

    // Fire-and-forget send loop so the API can return quickly; client polls status.
    void this.processSends(organizationId, ownerUserId, campaign.id, from);

    return this.prisma.emailCampaign.findFirstOrThrow({
      where: { id: campaign.id },
    });
  }

  private async processSends(
    organizationId: string,
    ownerUserId: string,
    campaignId: string,
    from: string,
  ): Promise<void> {
    try {
      const campaign = await this.prisma.emailCampaign.findFirstOrThrow({
        where: { id: campaignId, organizationId },
      });
      const pending = await this.prisma.emailCampaignSend.findMany({
        where: { campaignId, status: EmailSendStatus.PENDING },
        include: { business: true },
        orderBy: { createdAt: "asc" },
      });

      let sentCount = campaign.sentCount;
      let failedCount = campaign.failedCount;

      for (const send of pending) {
        const stillRunning = await this.prisma.emailCampaign.findFirst({
          where: { id: campaignId, status: EmailCampaignStatus.SENDING },
        });
        if (!stillRunning) break;

        try {
          const subject = fillTemplate(campaign.subject, {
            name: send.business.name,
            city: send.business.city,
          });
          const text = fillTemplate(campaign.body, {
            name: send.business.name,
            city: send.business.city,
          });

          const result = await this.resend.sendMail({
            from,
            to: send.toEmail,
            subject,
            text,
          });

          await this.prisma.$transaction([
            this.prisma.emailCampaignSend.update({
              where: { id: send.id },
              data: {
                status: EmailSendStatus.SENT,
                resendId: result.id,
                sentAt: new Date(),
                errorMessage: null,
              },
            }),
            this.prisma.outreachEvent.create({
              data: {
                organizationId,
                businessId: send.businessId,
                type: OutreachType.EMAIL,
              },
            }),
            this.prisma.business.update({
              where: { id: send.businessId },
              data: { emailSentAt: new Date() },
            }),
          ]);
          await this.leadPool.markContacted(send.business.googlePlaceId, ownerUserId);
          sentCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Send failed";
          this.logger.warn(`Campaign ${campaignId} send failed for ${send.toEmail}: ${message}`);
          await this.prisma.emailCampaignSend.update({
            where: { id: send.id },
            data: {
              status: EmailSendStatus.FAILED,
              errorMessage: message.slice(0, 500),
            },
          });
          failedCount += 1;
        }

        await this.prisma.emailCampaign.update({
          where: { id: campaignId },
          data: { sentCount, failedCount },
        });

        await sleep(SEND_DELAY_MS);
      }

      await this.prisma.emailCampaign.update({
        where: { id: campaignId },
        data: {
          status: EmailCampaignStatus.COMPLETED,
          completedAt: new Date(),
          sentCount,
          failedCount,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Campaign failed";
      this.logger.error(`Email campaign ${campaignId} failed: ${message}`);
      await this.prisma.emailCampaign.update({
        where: { id: campaignId },
        data: {
          status: EmailCampaignStatus.FAILED,
          completedAt: new Date(),
          errorMessage: message.slice(0, 500),
        },
      });
    }
  }

  private audienceWhere(
    organizationId: string,
    offerType: EmailOfferType,
    options: { skipAlreadyEmailed: boolean; searchCampaignId?: string },
  ): Prisma.BusinessWhereInput {
    const offerFilter = this.offerTypeFilter(offerType);
    const discoveryFilter: Prisma.BusinessWhereInput | undefined = options.searchCampaignId
      ? {
          discoveries: {
            some: {
              run: { campaignId: options.searchCampaignId },
            },
          },
        }
      : undefined;

    return {
      organizationId,
      email: { not: null },
      ...(options.skipAlreadyEmailed ? { emailSentAt: null } : {}),
      ...offerFilter,
      ...discoveryFilter,
    };
  }

  private offerTypeFilter(offerType: EmailOfferType): Prisma.BusinessWhereInput {
    switch (offerType) {
      case EmailOfferType.NEED_WEBSITE:
        return { websiteUrl: null };
      case EmailOfferType.NEED_SEO:
        return { websiteUrl: { not: null } };
      case EmailOfferType.NEED_REVIEWS:
        return {
          OR: [{ reviewCount: null }, { reviewCount: { lte: 40 } }, { rating: { lte: 4.3 } }],
        };
      default:
        return {};
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keep Business type referenced for clarity in future expansions.
export type AudienceLead = Pick<
  Business,
  "id" | "name" | "email" | "websiteUrl" | "city" | "rating" | "reviewCount"
>;
