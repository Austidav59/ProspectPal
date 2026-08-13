import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { OutreachType, type Business } from "../generated/prisma";

import { PrismaService } from "../database/prisma.service";
import { GmailService } from "../email/gmail.service";
import { LeadPoolService } from "../leads/lead-pool.service";
import { SettingsService } from "../settings/settings.service";

export interface OutreachSummary {
  dmsToday: number;
  emailsToday: number;
  dmDailyLimit: number;
}

@Injectable()
export class OutreachService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly leadPool: LeadPoolService,
    private readonly gmail: GmailService,
  ) {}

  async summary(organizationId: string, dayStart: Date): Promise<OutreachSummary> {
    const [settings, dmsToday, emailsToday] = await Promise.all([
      this.settings.getOrCreate(organizationId),
      this.countSince(organizationId, OutreachType.DM, dayStart),
      this.countSince(organizationId, OutreachType.EMAIL, dayStart),
    ]);
    return { dmsToday, emailsToday, dmDailyLimit: settings.dmDailyLimit };
  }

  async markDm(
    organizationId: string,
    ownerUserId: string,
    businessId: string,
    dayStart: Date,
  ): Promise<Business> {
    const business = await this.requireBusiness(organizationId, businessId);
    const settings = await this.settings.getOrCreate(organizationId);
    const dmsToday = await this.countSince(organizationId, OutreachType.DM, dayStart);

    if (dmsToday >= settings.dmDailyLimit) {
      throw new ConflictException(
        `Daily DM limit reached (${settings.dmDailyLimit}). Try again tomorrow to keep your account safe.`,
      );
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.outreachEvent.create({
        data: { organizationId, businessId, type: OutreachType.DM },
      }),
      this.prisma.business.update({
        where: { id: businessId },
        data: { dmSentAt: business.dmSentAt ?? new Date() },
      }),
    ]);
    await this.leadPool.markContacted(business.googlePlaceId, ownerUserId);
    return updated;
  }

  async sendOfferEmail(
    organizationId: string,
    ownerUserId: string,
    businessId: string,
  ): Promise<Business> {
    const business = await this.requireBusiness(organizationId, businessId);
    if (!business.email) {
      throw new BadRequestException("This business has no email address saved yet");
    }

    const settings = await this.settings.getOrCreate(organizationId);
    const subject = settings.emailSubject.replaceAll("{name}", business.name);
    const text = settings.emailTemplate.replaceAll("{name}", business.name);

    await this.gmail.sendMail({
      userId: ownerUserId,
      to: business.email,
      subject,
      text,
    });

    const [, updated] = await this.prisma.$transaction([
      this.prisma.outreachEvent.create({
        data: { organizationId, businessId, type: OutreachType.EMAIL },
      }),
      this.prisma.business.update({
        where: { id: businessId },
        data: { emailSentAt: new Date() },
      }),
    ]);
    await this.leadPool.markContacted(business.googlePlaceId, ownerUserId);
    return updated;
  }

  async setReplied(
    organizationId: string,
    ownerUserId: string,
    businessId: string,
    replied: boolean,
  ): Promise<Business> {
    const business = await this.requireBusiness(organizationId, businessId);
    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: { repliedAt: replied ? new Date() : null },
    });
    await this.leadPool.markReplied(business.googlePlaceId, ownerUserId, replied);
    return updated;
  }

  private async requireBusiness(organizationId: string, id: string): Promise<Business> {
    const business = await this.prisma.business.findFirst({ where: { id, organizationId } });
    if (!business) throw new NotFoundException("Business was not found");
    return business;
  }

  private countSince(organizationId: string, type: OutreachType, since: Date): Promise<number> {
    return this.prisma.outreachEvent.count({
      where: { organizationId, type, createdAt: { gte: since } },
    });
  }
}
