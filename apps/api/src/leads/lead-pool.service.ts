import { Injectable, Logger } from "@nestjs/common";
import type { SearchCampaign, SharedPlace } from "../generated/prisma";

import { PrismaService } from "../database/prisma.service";
import { DiscoveryProviderService } from "../discovery/discovery-provider.service";
import type { DiscoveredBusiness } from "../discovery/discovery.types";
import {
  LEAD_COOLDOWN_MS,
  MAX_POOL_REPLENISH_ATTEMPTS,
  MIN_AVAILABLE_BEFORE_REFRESH,
  SKIP_TOP_GOOGLE_RANKS,
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
    for (let attempt = 0; attempt < MAX_POOL_REPLENISH_ATTEMPTS; attempt += 1) {
      const available = await this.countAvailable(searchKey, input.ownerUserId);
      if (available >= input.limit && attempt > 0) break;
      if (
        attempt === 0 &&
        available >= Math.min(MIN_AVAILABLE_BEFORE_REFRESH, input.limit)
      ) {
        const recordedRanks = await this.prisma.marketTopRanker.count({
          where: { searchKey },
        });
        if (recordedRanks >= Math.min(available + SKIP_TOP_GOOGLE_RANKS, input.limit + SKIP_TOP_GOOGLE_RANKS)) {
          break;
        }
      }

      refreshedFromGoogle = true;
      const fetchSize = Math.min(
        120,
        Math.max(input.limit + SKIP_TOP_GOOGLE_RANKS, 40) + attempt * 25,
      );
      this.logger.log(
        `Pool refresh attempt ${attempt + 1}/${MAX_POOL_REPLENISH_ATTEMPTS} for ${searchKey} (fetch ${fetchSize}, need ${input.limit} after skipping top ${SKIP_TOP_GOOGLE_RANKS})`,
      );
      await this.replenishFromGoogle({
        searchKey,
        marketKey,
        categoryKey,
        campaign: input.campaign,
        maximumResults: fetchSize,
      });

      const pool = await this.prisma.marketSearchPool.findUnique({
        where: { searchKey },
      });
      if (pool?.searchExhausted) break;

      const after = await this.countAvailable(searchKey, input.ownerUserId);
      if (after >= input.limit) break;
    }

    const topSkipped = await this.topRankerSkipSet(searchKey);
    const candidates = await this.listAvailableCandidates(
      searchKey,
      marketKey,
      categoryKey,
      input.ownerUserId,
      Math.max(input.limit * 3, 30),
      topSkipped,
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
    const short = claimed.length > 0 && claimed.length < input.limit;

    return {
      searchKey,
      claimed,
      refreshedFromGoogle,
      exhausted,
      message:
        claimed.length === 0
          ? exhausted
            ? "No fresh leads in this market — Maps results are exhausted or the remaining businesses are locked."
            : "No fresh leads available right now. Try again after the pool refreshes."
          : short
            ? `Found ${claimed.length} of ${input.limit} requested leads (skipped top ${SKIP_TOP_GOOGLE_RANKS} Google results).`
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

  private async topRankerSkipSet(searchKey: string): Promise<Set<string>> {
    const top = await this.prisma.marketTopRanker.findMany({
      where: {
        searchKey,
        rank: { lte: SKIP_TOP_GOOGLE_RANKS },
      },
      select: { googlePlaceId: true },
    });
    return new Set(top.map((row) => row.googlePlaceId));
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
    const skipTop = await this.topRankerSkipSet(searchKey);

    const places = await this.prisma.sharedPlace.findMany({
      where: {
        marketKey,
        categoryKey,
        businessStatus: { not: "CLOSED_PERMANENTLY" },
      },
      select: { googlePlaceId: true },
    });

    return places.filter(
      (place) =>
        !lockedSet.has(place.googlePlaceId) && !skipTop.has(place.googlePlaceId),
    ).length;
  }

  private async listAvailableCandidates(
    searchKey: string,
    marketKey: string,
    categoryKey: string,
    ownerUserId: string,
    take: number,
    skipTop: Set<string>,
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
      take: take * 3,
    });

    return places
      .filter(
        (place) =>
          !lockedSet.has(place.googlePlaceId) &&
          !skipTop.has(place.googlePlaceId),
      )
      .slice(0, take);
  }

  private async replenishFromGoogle(input: {
    searchKey: string;
    marketKey: string;
    categoryKey: string;
    campaign: SearchCampaign;
    maximumResults: number;
  }): Promise<void> {
    this.logger.log(
      `Replenishing shared pool for ${input.searchKey} from discovery provider`,
    );
    const discovered = await this.provider.search({
      country: input.campaign.country,
      state: input.campaign.state,
      city: input.campaign.city,
      postalCode: input.campaign.postalCode,
      radiusMeters: input.campaign.radiusMeters,
      niche: input.campaign.niche,
      keyword: input.campaign.keyword,
      maximumResults: input.maximumResults,
    });

    if (discovered.length === 0) {
      await this.prisma.marketSearchPool.update({
        where: { searchKey: input.searchKey },
        data: { searchExhausted: true, lastRefreshedAt: new Date() },
      });
      return;
    }

    for (const candidate of discovered) {
      await this.upsertSharedPlace(
        candidate,
        input.marketKey,
        input.categoryKey,
        input.campaign,
      );
    }

    // Preserve Maps result order so we can skip the top 3 winners.
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
        searchExhausted: discovered.length < input.maximumResults * 0.5,
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
