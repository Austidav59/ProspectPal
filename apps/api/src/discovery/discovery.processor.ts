import { Injectable, Logger } from "@nestjs/common";
import type { SearchCampaign, SearchSource } from "../generated/prisma";
import { CampaignRunStatus } from "../generated/prisma";

import { PrismaService } from "../database/prisma.service";
import { LeadPoolService } from "../leads/lead-pool.service";
import { InstagramScraperService } from "../scraping/instagram-scraper.service";
import { SocialSearchService } from "../scraping/social-search.service";
import type { DiscoveredBusiness } from "./discovery.types";

const SOCIAL_SEARCH_DELAY_MS = 1_500;

@Injectable()
export class DiscoveryProcessor {
  private readonly logger = new Logger(DiscoveryProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly instagramScraper: InstagramScraperService,
    private readonly socialSearch: SocialSearchService,
    private readonly leadPool: LeadPoolService,
  ) {}

  async process(runId: string): Promise<void> {
    const run = await this.prisma.campaignRun.findUnique({
      where: { id: runId },
      include: { campaign: true },
    });
    if (!run) throw new Error(`Campaign run ${runId} was not found`);
    if (run.status === CampaignRunStatus.COMPLETED) return;

    await this.prisma.campaignRun.update({
      where: { id: run.id },
      data: {
        status: CampaignRunStatus.RUNNING,
        startedAt: run.startedAt ?? new Date(),
        completedAt: null,
        errorMessage: null,
        poolMessage: null,
      },
    });

    try {
      const ownerUserId = run.ownerUserId;
      if (!ownerUserId) {
        throw new Error(
          "Campaign run is missing ownerUserId — cannot claim exclusive leads",
        );
      }

      // Shared pool first (reuses Google results across users). Claims lock
      // leads for 6 months for everyone except this owner.
      const claim = await this.leadPool.claimLeadsForCampaign({
        campaign: run.campaign,
        ownerUserId,
        organizationId: run.campaign.organizationId,
        limit: run.campaign.maximumResults,
      });

      let createdCount = 0;
      let updatedCount = 0;

      for (const lead of claim.claimed) {
        const shared = lead.shared;
        const candidate: DiscoveredBusiness = {
          googlePlaceId: shared.googlePlaceId,
          externalProviderId: shared.googlePlaceId,
          name: shared.name,
          primaryCategory: shared.primaryCategory,
          categories: shared.categories,
          phone: shared.phone,
          websiteUrl: shared.websiteUrl,
          address: shared.address,
          latitude: shared.latitude,
          longitude: shared.longitude,
          googleMapsUrl: shared.googleMapsUrl,
          rating: shared.rating,
          reviewCount: shared.reviewCount,
          businessStatus: shared.businessStatus,
          rawData: {
            googlePlaceId: shared.googlePlaceId,
            receptivenessScore: lead.receptiveness.score,
            receptivenessLabel: lead.receptiveness.label,
            receptivenessReasons: lead.receptiveness.reasons,
            fromSharedPool: true,
            refreshedFromGoogle: claim.refreshedFromGoogle,
          },
        };

        if (!this.isEligible(run.campaign, candidate)) continue;
        const wasCreated = await this.storeBusiness(
          run.id,
          run.source,
          run.campaign,
          candidate,
        );
        if (wasCreated) createdCount += 1;
        else updatedCount += 1;
      }

      await this.prisma.campaignRun.update({
        where: { id: run.id },
        data: {
          status: CampaignRunStatus.COMPLETED,
          discoveredCount: claim.claimed.length,
          createdCount,
          updatedCount,
          filteredCount: 0,
          completedAt: new Date(),
          errorMessage: null,
          poolMessage: claim.message,
        },
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown discovery failure";
      await this.prisma.campaignRun.update({
        where: { id: run.id },
        data: {
          status: CampaignRunStatus.FAILED,
          completedAt: new Date(),
          errorMessage: message.slice(0, 1_000),
        },
      });
      throw error;
    }

    // Website/social enrichment is intentionally handled by the fair catch-up
    // worker. Do not block the discovery queue for minutes while scanning each
    // lead; the UI already shows claimed leads as "finding contact info".
  }

  /** Fair, per-org catch-up: never scans all unfinished leads globally. */
  async enrichPendingLeads(perOrgLimit = 5, maxOrgs = 8): Promise<number> {
    const organizationIds =
      await this.findOrganizationsNeedingEnrichment(maxOrgs);
    if (organizationIds.length === 0) return 0;

    let total = 0;
    for (const organizationId of organizationIds) {
      total += await this.enrichOrganization(organizationId, perOrgLimit);
    }
    return total;
  }

  private async findOrganizationsNeedingEnrichment(
    maxOrgs: number,
  ): Promise<string[]> {
    const [websiteOrgs, searchOrgs] = await Promise.all([
      this.prisma.business.findMany({
        where: {
          websiteUrl: { not: null },
          instagramScrapedAt: null,
        },
        distinct: ["organizationId"],
        select: { organizationId: true },
        orderBy: { discoveredAt: "desc" },
        take: maxOrgs,
      }),
      this.prisma.business.findMany({
        where: {
          OR: [
            { websiteUrl: null, websiteDiscoveryAttemptedAt: null },
            { instagramUrl: null, googleSearchAttemptedAt: null },
          ],
        },
        distinct: ["organizationId"],
        select: { organizationId: true },
        orderBy: { discoveredAt: "desc" },
        take: maxOrgs,
      }),
    ]);

    const ids = new Set<string>();
    for (const row of [...websiteOrgs, ...searchOrgs]) {
      ids.add(row.organizationId);
      if (ids.size >= maxOrgs) break;
    }
    return [...ids];
  }

  private async enrichOrganization(
    organizationId: string,
    limit: number,
  ): Promise<number> {
    const websitePending = await this.prisma.business.findMany({
      where: {
        organizationId,
        websiteUrl: { not: null },
        instagramScrapedAt: null,
      },
      select: { id: true, websiteUrl: true, name: true, city: true },
      take: limit,
      orderBy: { discoveredAt: "desc" },
    });

    if (websitePending.length > 0) {
      this.logger.log(
        `Org ${organizationId.slice(0, 8)}…: scanning ${websitePending.length} websites`,
      );
      await this.scanWebsiteBatch(websitePending);
    }

    const searchBudget = Math.max(0, limit - websitePending.length);
    if (searchBudget === 0) return websitePending.length;

    const searched = await this.searchMissingSocials({
      organizationId,
      limit: searchBudget,
    });
    return websitePending.length + searched;
  }

  private async scanWebsiteBatch(
    pending: Array<{
      id: string;
      websiteUrl: string | null;
      name: string;
      city: string;
    }>,
  ): Promise<void> {
    for (const business of pending) {
      try {
        let instagramUrl: string | null = null;
        let facebookUrl: string | null = null;
        let email: string | null = null;

        if (business.websiteUrl) {
          const scan = await this.instagramScraper.scanWebsite(
            business.websiteUrl,
          );
          instagramUrl = scan.instagramUrl;
          facebookUrl = scan.facebookUrl;
          email = scan.email;
        }

        // Always try Google/DuckDuckGo when the site didn't give us Instagram.
        let googleSearchAttemptedAt: Date | null = null;
        if (!instagramUrl) {
          this.logger.log(
            `No Instagram on site for "${business.name}" — searching Google automatically`,
          );
          const found = await this.socialSearch.findSocialProfiles(
            business.name,
            business.city,
          );
          instagramUrl = found.instagramUrl;
          facebookUrl = facebookUrl ?? found.facebookUrl;
          googleSearchAttemptedAt = new Date();
          await new Promise((resolve) =>
            setTimeout(resolve, SOCIAL_SEARCH_DELAY_MS),
          );
        } else {
          // Site had Instagram — no need to search, mark search as skipped/done.
          googleSearchAttemptedAt = new Date();
        }

        await this.prisma.business.update({
          where: { id: business.id },
          data: {
            instagramUrl,
            facebookUrl,
            email,
            instagramScrapedAt: new Date(),
            socialScrapedAt: new Date(),
            googleSearchAttemptedAt,
          },
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Website scan failed for business ${business.id}: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        await this.prisma.business.update({
          where: { id: business.id },
          data: {
            instagramScrapedAt: new Date(),
            socialScrapedAt: new Date(),
            // Leave googleSearchAttemptedAt null so catch-up can still search.
          },
        });
      }
    }
  }

  private async searchMissingSocials(options: {
    runId?: string;
    organizationId?: string;
    limit: number;
  }): Promise<number> {
    const pending = await this.prisma.business.findMany({
      where: {
        OR: [
          { websiteUrl: null, websiteDiscoveryAttemptedAt: null },
          { instagramUrl: null, googleSearchAttemptedAt: null },
        ],
        ...(options.organizationId
          ? { organizationId: options.organizationId }
          : {}),
        ...(options.runId
          ? { discoveries: { some: { runId: options.runId } } }
          : {}),
      },
      select: {
        id: true,
        name: true,
        city: true,
        websiteUrl: true,
        websiteDiscoveryAttemptedAt: true,
        instagramUrl: true,
        instagramScrapedAt: true,
        facebookUrl: true,
        email: true,
        googleSearchAttemptedAt: true,
      },
      take: options.limit,
      orderBy: { discoveredAt: "desc" },
    });
    if (pending.length === 0) return 0;

    this.logger.log(`Running contact fallbacks for ${pending.length} leads`);
    for (const business of pending) {
      try {
        let websiteUrl = business.websiteUrl;
        let instagramUrl = business.instagramUrl;
        let facebookUrl = business.facebookUrl;
        let email = business.email;
        let instagramScrapedAt = business.instagramScrapedAt;
        let websiteDiscoveryAttemptedAt = business.websiteDiscoveryAttemptedAt;
        let googleSearchAttemptedAt = business.googleSearchAttemptedAt;

        if (!websiteUrl && !websiteDiscoveryAttemptedAt) {
          this.logger.log(`Finding an official website for "${business.name}"`);
          websiteUrl = await this.socialSearch.findOfficialWebsite(
            business.name,
            business.city,
          );
          websiteDiscoveryAttemptedAt = new Date();

          if (websiteUrl) {
            const scan = await this.instagramScraper.scanWebsite(websiteUrl);
            instagramUrl = scan.instagramUrl;
            facebookUrl = scan.facebookUrl;
            email = scan.email;
            instagramScrapedAt = new Date();
          }
        }

        if (!instagramUrl && !googleSearchAttemptedAt) {
          const socials = await this.socialSearch.findSocialProfiles(
            business.name,
            business.city,
          );
          instagramUrl = socials.instagramUrl;
          facebookUrl = facebookUrl ?? socials.facebookUrl;
          googleSearchAttemptedAt = new Date();
        }

        await this.prisma.business.update({
          where: { id: business.id },
          data: {
            websiteUrl,
            websiteDiscoveryAttemptedAt,
            instagramUrl,
            instagramScrapedAt,
            facebookUrl,
            email,
            socialScrapedAt: new Date(),
            googleSearchAttemptedAt,
          },
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Contact fallback failed for business ${business.id}: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        await this.prisma.business.update({
          where: { id: business.id },
          data: {
            socialScrapedAt: new Date(),
            // Leave stage timestamps unchanged so transient failures retry.
          },
        });
      }
      await new Promise((resolvePause) =>
        setTimeout(resolvePause, SOCIAL_SEARCH_DELAY_MS),
      );
    }
    return pending.length;
  }

  /** @deprecated use enrichPendingLeads */
  async scanPendingWebsites(limit = 40): Promise<number> {
    return this.enrichPendingLeads(Math.min(5, limit), Math.ceil(limit / 5));
  }

  private isEligible(
    campaign: SearchCampaign,
    business: DiscoveredBusiness,
  ): boolean {
    const hasWebsite = Boolean(business.websiteUrl);
    if (hasWebsite && !campaign.includeWithWebsites) return false;
    if (!hasWebsite && !campaign.includeWithoutWebsites) return false;
    if (
      campaign.minimumRating !== null &&
      (business.rating === null || business.rating < campaign.minimumRating)
    ) {
      return false;
    }
    if (
      campaign.minimumReviewCount !== null &&
      (business.reviewCount === null ||
        business.reviewCount < campaign.minimumReviewCount)
    ) {
      return false;
    }
    if (
      campaign.maximumReviewCount !== null &&
      business.reviewCount !== null &&
      business.reviewCount > campaign.maximumReviewCount
    ) {
      return false;
    }
    return business.businessStatus !== "CLOSED_PERMANENTLY";
  }

  private async storeBusiness(
    runId: string,
    source: SearchSource,
    campaign: SearchCampaign,
    candidate: DiscoveredBusiness,
  ): Promise<boolean> {
    const existing = await this.prisma.business.findUnique({
      where: {
        organizationId_googlePlaceId: {
          organizationId: campaign.organizationId,
          googlePlaceId: candidate.googlePlaceId,
        },
      },
      select: { id: true },
    });

    const business = await this.prisma.business.upsert({
      where: {
        organizationId_googlePlaceId: {
          organizationId: campaign.organizationId,
          googlePlaceId: candidate.googlePlaceId,
        },
      },
      create: {
        organizationId: campaign.organizationId,
        googlePlaceId: candidate.googlePlaceId,
        externalProviderId: candidate.externalProviderId,
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
        searchSource: source,
        searchCity: campaign.city,
        searchNiche: campaign.niche,
      },
      update: {
        externalProviderId: candidate.externalProviderId,
        name: candidate.name,
        primaryCategory: candidate.primaryCategory,
        categories: candidate.categories,
        phone: candidate.phone,
        websiteUrl: candidate.websiteUrl,
        address: candidate.address,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        googleMapsUrl: candidate.googleMapsUrl,
        rating: candidate.rating,
        reviewCount: candidate.reviewCount,
        businessStatus: candidate.businessStatus,
        searchSource: source,
        searchCity: campaign.city,
        searchNiche: campaign.niche,
      },
    });

    await this.prisma.businessDiscovery.upsert({
      where: {
        runId_businessId: {
          runId,
          businessId: business.id,
        },
      },
      create: {
        runId,
        businessId: business.id,
        rawData: candidate.rawData,
      },
      update: { rawData: candidate.rawData },
    });

    return existing === null;
  }
}
