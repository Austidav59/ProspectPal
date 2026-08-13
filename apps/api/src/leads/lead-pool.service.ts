import { Injectable, Logger } from "@nestjs/common";
import type { SearchCampaign, SharedPlace } from "../generated/prisma";

import { PrismaService } from "../database/prisma.service";
import { DiscoveryProviderService } from "../discovery/discovery-provider.service";
import type { DiscoveredBusiness } from "../discovery/discovery.types";
import {
  LEAD_COOLDOWN_MS,
  MIN_AVAILABLE_BEFORE_REFRESH,
  buildSearchKey,
  normalizeCategoryKey,
  normalizeMarketKey,
  scoreReceptiveness,
  type ReceptivenessResult,
} from "./receptiveness";

export interface ClaimedLead {
  shared: SharedPlace;
  receptiveness: ReceptivenessResult;
  isTopRanker: boolean;
}

export interface ClaimResult {
  searchKey: string;
  claimed: ClaimedLead[];
  refreshedFromGoogle: boolean;
  exhausted: boolean;
  message: string | null;
}

@Injectable()
export class LeadPoolService {
  private readonly logger = new Logger(LeadPoolService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: DiscoveryProviderService,
  ) {}

  async claimLeadsForCampaign(input: {
    campaign: SearchCampaign;
    ownerUserId: string;
    organizationId: string;
    limit: number;
  }): Promise<ClaimResult> {
    const marketKey = normalizeMarketKey(
      input.campaign.city,
      input.campaign.state,
    );
    const categoryKey = normalizeCategoryKey(input.campaign.niche);
    const searchKey = buildSearchKey(marketKey, categoryKey);

    await this.ensurePoolRow({
      searchKey,
      marketKey,
      categoryKey,
      city: input.campaign.city,
      state: input.campaign.state,
      country: input.campaign.country,
      niche: input.campaign.niche,
    });

    let refreshedFromGoogle = false;
    let available = await this.countAvailable(searchKey, input.ownerUserId);
    const recordedRanks = await this.prisma.marketTopRanker.count({
      where: { searchKey },
    });
    if (
      available < Math.min(MIN_AVAILABLE_BEFORE_REFRESH, input.limit) ||
      recordedRanks < Math.min(available, input.limit)
    ) {
      refreshedFromGoogle = true;
      await this.replenishFromGoogle({
        searchKey,
        marketKey,
        categoryKey,
        campaign: input.campaign,
      });
      available = await this.countAvailable(searchKey, input.ownerUserId);
    }

    const candidates = await this.listAvailableCandidates(
      marketKey,
      categoryKey,
      input.ownerUserId,
      Math.max(input.limit * 3, 30),
    );

    const ranked = candidates
      .map((shared) => ({
        shared,
        receptiveness: scoreReceptiveness({
          websiteUrl: shared.websiteUrl,
          rating: shared.rating,
          reviewCount: shared.reviewCount,
          businessStatus: shared.businessStatus,
          timesServed: shared.timesServed,
        }),
        isTopRanker: false,
      }))
      .sort(
        (a, b) =>
          b.receptiveness.score - a.receptiveness.score ||
          a.shared.timesServed - b.shared.timesServed,
      );

    const toClaim = ranked.slice(0, input.limit);
    const claimed: ClaimedLead[] = [];
    const cooldownUntil = new Date(Date.now() + LEAD_COOLDOWN_MS);

    for (const lead of toClaim) {
      await this.prisma.$transaction(async (tx) => {
        // Skip if another org locked it since we listed candidates.
        const locked = await tx.leadAssignment.findFirst({
          where: {
            googlePlaceId: lead.shared.googlePlaceId,
            cooldownUntil: { gt: new Date() },
            ownerUserId: { not: input.ownerUserId },
          },
        });
        if (locked) return;

        await tx.leadAssignment.create({
          data: {
            googlePlaceId: lead.shared.googlePlaceId,
            ownerUserId: input.ownerUserId,
            organizationId: input.organizationId,
            cooldownUntil,
          },
        });
        await tx.sharedPlace.update({
          where: { googlePlaceId: lead.shared.googlePlaceId },
          data: { timesServed: { increment: 1 } },
        });
        claimed.push(lead);
      });
    }

    const pool = await this.prisma.marketSearchPool.findUnique({
      where: { searchKey },
    });
    const exhausted = claimed.length === 0 && (pool?.searchExhausted ?? false);

    return {
      searchKey,
      claimed,
      refreshedFromGoogle,
      exhausted,
      message:
        claimed.length === 0
          ? exhausted
            ? "No fresh leads in this market — Google results are exhausted or the remaining businesses are locked."
            : "No fresh leads available right now. Try again after the pool refreshes."
          : null,
    };
  }

  async markContacted(
    googlePlaceId: string,
    ownerUserId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.leadAssignment.updateMany({
      where: {
        googlePlaceId,
        ownerUserId,
        cooldownUntil: { gt: now },
      },
      data: {
        contactedAt: now,
        cooldownUntil: new Date(now.getTime() + LEAD_COOLDOWN_MS),
      },
    });
  }

  async markReplied(
    googlePlaceId: string,
    ownerUserId: string,
    replied: boolean,
  ): Promise<void> {
    const now = new Date();
    if (!replied) {
      await this.prisma.leadAssignment.updateMany({
        where: { googlePlaceId, ownerUserId },
        data: { repliedAt: null },
      });
      return;
    }
    await this.prisma.leadAssignment.updateMany({
      where: {
        googlePlaceId,
        ownerUserId,
      },
      data: {
        repliedAt: now,
        cooldownUntil: new Date(now.getTime() + LEAD_COOLDOWN_MS),
      },
    });
  }

  async getActiveAssignment(googlePlaceId: string, ownerUserId: string) {
    return this.prisma.leadAssignment.findFirst({
      where: {
        googlePlaceId,
        ownerUserId,
        cooldownUntil: { gt: new Date() },
      },
      orderBy: { shownAt: "desc" },
    });
  }

  private async ensurePoolRow(input: {
    searchKey: string;
    marketKey: string;
    categoryKey: string;
    city: string;
    state: string | null;
    country: string;
    niche: string;
  }): Promise<void> {
    await this.prisma.marketSearchPool.upsert({
      where: { searchKey: input.searchKey },
      create: {
        searchKey: input.searchKey,
        marketKey: input.marketKey,
        categoryKey: input.categoryKey,
        city: input.city,
        state: input.state,
        country: input.country,
        niche: input.niche,
        updatedAt: new Date(),
      },
      update: {
        city: input.city,
        state: input.state,
        country: input.country,
        niche: input.niche,
      },
    });
  }

  private async countAvailable(
    searchKey: string,
    ownerUserId: string,
  ): Promise<number> {
    const [marketKey, categoryKey] = searchKey.split("|");
    if (!marketKey || !categoryKey) return 0;

    const locked = await this.prisma.leadAssignment.findMany({
      where: {
        cooldownUntil: { gt: new Date() },
        ownerUserId: { not: ownerUserId },
      },
      select: { googlePlaceId: true },
      distinct: ["googlePlaceId"],
    });
    const lockedSet = new Set(locked.map((row) => row.googlePlaceId));

    const places = await this.prisma.sharedPlace.findMany({
      where: {
        marketKey,
        categoryKey,
        businessStatus: { not: "CLOSED_PERMANENTLY" },
      },
      select: { googlePlaceId: true },
    });

    return places.filter((place) => !lockedSet.has(place.googlePlaceId)).length;
  }

  private async listAvailableCandidates(
    marketKey: string,
    categoryKey: string,
    ownerUserId: string,
    take: number,
  ): Promise<SharedPlace[]> {
    const locked = await this.prisma.leadAssignment.findMany({
      where: {
        cooldownUntil: { gt: new Date() },
        ownerUserId: { not: ownerUserId },
      },
      select: { googlePlaceId: true },
      distinct: ["googlePlaceId"],
    });
    const lockedSet = new Set(locked.map((row) => row.googlePlaceId));

    const places = await this.prisma.sharedPlace.findMany({
      where: {
        marketKey,
        categoryKey,
        businessStatus: { not: "CLOSED_PERMANENTLY" },
      },
      orderBy: [{ timesServed: "asc" }, { reviewCount: "asc" }],
      take: take * 2,
    });

    return places
      .filter((place) => !lockedSet.has(place.googlePlaceId))
      .slice(0, take);
  }

  private async replenishFromGoogle(input: {
    searchKey: string;
    marketKey: string;
    categoryKey: string;
    campaign: SearchCampaign;
  }): Promise<void> {
    this.logger.log(
      `Replenishing shared pool for ${input.searchKey} from Google Places`,
    );
    const discovered = await this.provider.search({
      country: input.campaign.country,
      state: input.campaign.state,
      city: input.campaign.city,
      postalCode: input.campaign.postalCode,
      radiusMeters: input.campaign.radiusMeters,
      niche: input.campaign.niche,
      keyword: input.campaign.keyword,
      maximumResults: Math.max(input.campaign.maximumResults, 40),
    });

    if (discovered.length === 0) {
      await this.prisma.marketSearchPool.update({
        where: { searchKey: input.searchKey },
        data: { searchExhausted: true, lastRefreshedAt: new Date() },
      });
      return;
    }

    for (const [index, candidate] of discovered.entries()) {
      await this.upsertSharedPlace(
        candidate,
        input.marketKey,
        input.categoryKey,
        input.campaign,
      );
    }

    // Preserve the complete Google result order for ranking context.
    await this.prisma.marketTopRanker.deleteMany({
      where: { searchKey: input.searchKey },
    });
    for (const [index, candidate] of discovered.entries()) {
      await this.prisma.marketTopRanker.create({
        data: {
          searchKey: input.searchKey,
          googlePlaceId: candidate.googlePlaceId,
          rank: index + 1,
          observedAt: new Date(),
        },
      });
    }

    await this.prisma.marketSearchPool.update({
      where: { searchKey: input.searchKey },
      data: {
        lastRefreshedAt: new Date(),
        searchExhausted: discovered.length < 5,
      },
    });
  }

  private async upsertSharedPlace(
    candidate: DiscoveredBusiness,
    marketKey: string,
    categoryKey: string,
    campaign: SearchCampaign,
  ): Promise<void> {
    await this.prisma.sharedPlace.upsert({
      where: { googlePlaceId: candidate.googlePlaceId },
      create: {
        googlePlaceId: candidate.googlePlaceId,
        name: candidate.name,
        primaryCategory: candidate.primaryCategory,
        categories: candidate.categories,
        phone: candidate.phone,
        websiteUrl: candidate.websiteUrl,
        address: candidate.address,
        city: campaign.city,
        state: campaign.state,
        postalCode: campaign.postalCode,
        country: campaign.country,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        googleMapsUrl: candidate.googleMapsUrl,
        rating: candidate.rating,
        reviewCount: candidate.reviewCount,
        businessStatus: candidate.businessStatus,
        marketKey,
        categoryKey,
        lastSeenInSearchAt: new Date(),
      },
      update: {
        name: candidate.name,
        primaryCategory: candidate.primaryCategory,
        categories: candidate.categories,
        phone: candidate.phone,
        websiteUrl: candidate.websiteUrl,
        address: candidate.address,
        city: campaign.city,
        state: campaign.state,
        postalCode: campaign.postalCode,
        country: campaign.country,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        googleMapsUrl: candidate.googleMapsUrl,
        rating: candidate.rating,
        reviewCount: candidate.reviewCount,
        businessStatus: candidate.businessStatus,
        marketKey,
        categoryKey,
        lastSeenInSearchAt: new Date(),
      },
    });
  }
}
