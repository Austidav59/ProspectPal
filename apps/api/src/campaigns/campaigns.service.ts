import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  CampaignStatus,
  type Prisma,
  type SearchCampaign,
} from "../generated/prisma";

import { PrismaService } from "../database/prisma.service";
import { DiscoveryJobsService } from "../discovery/discovery-jobs.service";
import { DiscoveryProviderService } from "../discovery/discovery-provider.service";
import type {
  CampaignListQuery,
  CreateCampaignInput,
  UpdateCampaignInput,
} from "./campaign.schemas";

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: DiscoveryProviderService,
    private readonly jobs: DiscoveryJobsService,
  ) {}

  async list(organizationId: string, query: CampaignListQuery) {
    const where: Prisma.SearchCampaignWhereInput = {
      organizationId,
      // Default list is the "recent searches" feed: hide paused + archived campaigns.
      ...(query.status
        ? { status: query.status }
        : { status: { notIn: [CampaignStatus.ARCHIVED, CampaignStatus.PAUSED] } }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.searchCampaign.findMany({
        where,
        include: { runs: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.searchCampaign.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(organizationId: string, id: string) {
    const campaign = await this.prisma.searchCampaign.findFirst({
      where: { id, organizationId },
      include: { runs: { orderBy: { createdAt: "desc" }, take: 25 } },
    });
    if (!campaign) throw new NotFoundException("Campaign was not found");
    return campaign;
  }

  create(organizationId: string, input: CreateCampaignInput): Promise<SearchCampaign> {
    return this.prisma.searchCampaign.create({
      data: { organizationId, ...input },
    });
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateCampaignInput,
  ): Promise<SearchCampaign> {
    await this.get(organizationId, id);
    return this.prisma.searchCampaign.update({
      where: { id },
      data: this.toUpdateData(input),
    });
  }

  /** Soft-delete from the UI only — keeps rows so shared pool leads stay available. */
  async archive(organizationId: string, id: string): Promise<void> {
    await this.get(organizationId, id);
    await this.prisma.searchCampaign.update({
      where: { id },
      data: { status: CampaignStatus.ARCHIVED },
    });
  }

  async pause(organizationId: string, id: string): Promise<SearchCampaign> {
    await this.get(organizationId, id);
    return this.prisma.searchCampaign.update({
      where: { id },
      data: { status: CampaignStatus.PAUSED },
    });
  }

  /** Restore a hidden (paused) search back to Recent searches. */
  async unhide(organizationId: string, id: string): Promise<SearchCampaign> {
    const campaign = await this.get(organizationId, id);
    if (campaign.status !== CampaignStatus.PAUSED) {
      throw new ConflictException("Only hidden searches can be unhidden");
    }
    return this.prisma.searchCampaign.update({
      where: { id },
      data: { status: CampaignStatus.ACTIVE },
    });
  }

  async run(organizationId: string, id: string, ownerUserId: string) {
    const campaign = await this.get(organizationId, id);
    if (campaign.status !== CampaignStatus.ACTIVE) {
      throw new ConflictException("Only active campaigns can be run");
    }
    return this.jobs.enqueue(campaign.id, this.provider.source, ownerUserId);
  }

  private toUpdateData(input: UpdateCampaignInput): Prisma.SearchCampaignUpdateInput {
    const data: Prisma.SearchCampaignUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.country !== undefined) data.country = input.country;
    if (input.state !== undefined) data.state = input.state;
    if (input.city !== undefined) data.city = input.city;
    if (input.postalCode !== undefined) data.postalCode = input.postalCode;
    if (input.radiusMeters !== undefined) data.radiusMeters = input.radiusMeters;
    if (input.niche !== undefined) data.niche = input.niche;
    if (input.keyword !== undefined) data.keyword = input.keyword;
    if (input.maximumResults !== undefined) data.maximumResults = input.maximumResults;
    if (input.minimumRating !== undefined) data.minimumRating = input.minimumRating;
    if (input.minimumReviewCount !== undefined) {
      data.minimumReviewCount = input.minimumReviewCount;
    }
    if (input.maximumReviewCount !== undefined) {
      data.maximumReviewCount = input.maximumReviewCount;
    }
    if (input.includeWithWebsites !== undefined) {
      data.includeWithWebsites = input.includeWithWebsites;
    }
    if (input.includeWithoutWebsites !== undefined) {
      data.includeWithoutWebsites = input.includeWithoutWebsites;
    }
    if (input.schedule !== undefined) data.schedule = input.schedule;
    return data;
  }
}
