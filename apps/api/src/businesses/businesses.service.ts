import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SearchSource, type Business, type Prisma } from "../generated/prisma";

import { PrismaService } from "../database/prisma.service";
import { scoreReceptiveness } from "../leads/receptiveness";
import { InstagramScraperService } from "../scraping/instagram-scraper.service";
import { SocialSearchService } from "../scraping/social-search.service";
import type {
  BusinessListQuery,
  UpdateBusinessInput,
} from "./business.schemas";

const TEST_LEADS = [
  {
    key: "self",
    name: "TEST — Email to me",
    /** Prefer connected Gmail, else login email. */
    resolveEmail: (user: { email: string; gmailEmail: string | null }) =>
      user.gmailEmail ?? user.email,
  },
  {
    key: "marisabel",
    name: "TEST — Email to Marisabel",
    resolveEmail: () => "marisabeltrejoo@gmail.com",
  },
] as const;

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly instagramScraper: InstagramScraperService,
    private readonly socialSearch: SocialSearchService,
  ) {}

  async list(organizationId: string, query: BusinessListQuery) {
    const where: Prisma.BusinessWhereInput = {
      organizationId,
      ...(query.search
        ? { name: { contains: query.search, mode: "insensitive" } }
        : {}),
      ...(query.hasWebsite === undefined
        ? {}
        : { websiteUrl: query.hasWebsite ? { not: null } : null }),
      ...(query.campaignId
        ? { discoveries: { some: { run: { campaignId: query.campaignId } } } }
        : {}),
      ...(query.contacted === undefined
        ? {}
        : query.contacted
          ? {
              OR: [{ dmSentAt: { not: null } }, { emailSentAt: { not: null } }],
            }
          : { dmSentAt: null, emailSentAt: null }),
      ...(query.contactableOnly
        ? {
            OR: [
              { instagramUrl: { not: null } },
              { facebookUrl: { not: null } },
              { email: { not: null } },
              { websiteUrl: { not: null }, instagramScrapedAt: null },
              { websiteUrl: null, websiteDiscoveryAttemptedAt: null },
              { googleSearchAttemptedAt: null },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.business.findMany({
        where,
        orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.business.count({ where }),
    ]);

    const placeIds = rows.map((row) => row.googlePlaceId);
    const topRankers =
      placeIds.length === 0
        ? []
        : await this.prisma.marketTopRanker.findMany({
            where: { googlePlaceId: { in: placeIds } },
            select: { googlePlaceId: true, rank: true, searchKey: true },
          });
    const topByPlace = new Map(
      topRankers.map((row) => [row.googlePlaceId, row]),
    );

    const items = rows
      .map((business) => {
        const receptiveness = scoreReceptiveness({
          websiteUrl: business.websiteUrl,
          instagramUrl: business.instagramUrl,
          email: business.email,
          rating: business.rating,
          reviewCount: business.reviewCount,
          businessStatus: business.businessStatus,
        });
        const top = topByPlace.get(business.googlePlaceId);
        return {
          ...business,
          receptivenessScore: receptiveness.score,
          receptivenessLabel: receptiveness.label,
          receptivenessReasons: receptiveness.reasons,
          isTopGoogleRanker: Boolean(top),
          googleRank: top?.rank ?? null,
        };
      })
      .sort((a, b) => b.receptivenessScore - a.receptivenessScore);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(organizationId: string, id: string) {
    const business = await this.prisma.business.findFirst({
      where: { id, organizationId },
      include: {
        discoveries: {
          include: {
            run: {
              select: {
                id: true,
                campaignId: true,
                createdAt: true,
                source: true,
              },
            },
          },
          orderBy: { discoveredAt: "desc" },
        },
      },
    });
    if (!business) throw new NotFoundException("Business was not found");
    return business;
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateBusinessInput,
  ): Promise<Business> {
    await this.get(organizationId, id);
    return this.prisma.business.update({
      where: { id },
      data: this.toUpdateData(input),
    });
  }

  /** Temporary fake leads for testing Gmail send (to yourself + a fixed address). */
  async ensureTestEmailLeads(
    organizationId: string,
    userId: string,
  ): Promise<Business[]> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, memberships: { some: { organizationId } } },
      select: { email: true, gmailEmail: true },
    });
    if (!user?.email) {
      throw new BadRequestException(
        "Your account has no email address for the self test lead",
      );
    }

    const leads: Business[] = [];
    for (const spec of TEST_LEADS) {
      const email = spec.resolveEmail(user);
      const googlePlaceId = `prospect-pal-test-email-${spec.key}-${organizationId}`;
      const lead = await this.prisma.business.upsert({
        where: {
          organizationId_googlePlaceId: { organizationId, googlePlaceId },
        },
        create: {
          organizationId,
          googlePlaceId,
          externalProviderId: googlePlaceId,
          name: spec.name,
          primaryCategory: "Test lead",
          categories: ["test"],
          email,
          address: "Test inbox (Gmail send)",
          city: "Test City",
          state: null,
          postalCode: null,
          country: "United States",
          latitude: 0,
          longitude: 0,
          googleMapsUrl: null,
          rating: 5,
          reviewCount: 0,
          businessStatus: "OPERATIONAL",
          searchSource: SearchSource.MOCK,
          searchCity: "Test City",
          searchNiche: "test",
          websiteUrl: null,
          instagramUrl: null,
          facebookUrl: null,
          googleSearchAttemptedAt: new Date(),
          instagramScrapedAt: new Date(),
          socialScrapedAt: new Date(),
        },
        update: {
          name: spec.name,
          primaryCategory: "Test lead",
          email,
          emailSentAt: null,
          address: "Test inbox (Gmail send)",
          googleSearchAttemptedAt: new Date(),
          instagramScrapedAt: new Date(),
          socialScrapedAt: new Date(),
        },
      });
      leads.push(lead);
    }
    return leads;
  }

  async scrapeInstagram(organizationId: string, id: string): Promise<Business> {
    const business = await this.get(organizationId, id);

    let instagramUrl = business.instagramUrl;
    let facebookUrl = business.facebookUrl;
    let email = business.email;

    if (business.websiteUrl) {
      const scan = await this.instagramScraper.scanWebsite(business.websiteUrl);
      instagramUrl = scan.instagramUrl ?? instagramUrl;
      facebookUrl = scan.facebookUrl ?? facebookUrl;
      email = scan.email ?? email;
    }

    if (!instagramUrl || !facebookUrl) {
      const found = await this.socialSearch.findSocialProfiles(
        business.name,
        business.city,
      );
      instagramUrl = instagramUrl ?? found.instagramUrl;
      facebookUrl = facebookUrl ?? found.facebookUrl;
    }

    return this.prisma.business.update({
      where: { id },
      data: {
        instagramUrl,
        facebookUrl,
        email,
        instagramScrapedAt: new Date(),
        socialScrapedAt: new Date(),
        googleSearchAttemptedAt: new Date(),
      },
    });
  }

  async findSocials(organizationId: string, id: string): Promise<Business> {
    const business = await this.get(organizationId, id);
    const socials = await this.socialSearch.findSocialProfiles(
      business.name,
      business.city,
    );
    return this.prisma.business.update({
      where: { id },
      data: {
        instagramUrl: socials.instagramUrl ?? business.instagramUrl,
        facebookUrl: socials.facebookUrl ?? business.facebookUrl,
        instagramScrapedAt: business.instagramScrapedAt ?? new Date(),
        socialScrapedAt: new Date(),
        googleSearchAttemptedAt: new Date(),
      },
    });
  }

  private toUpdateData(input: UpdateBusinessInput): Prisma.BusinessUpdateInput {
    const data: Prisma.BusinessUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.primaryCategory !== undefined)
      data.primaryCategory = input.primaryCategory;
    if (input.categories !== undefined) data.categories = input.categories;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.websiteUrl !== undefined) data.websiteUrl = input.websiteUrl;
    if (input.instagramUrl !== undefined)
      data.instagramUrl = input.instagramUrl;
    if (input.facebookUrl !== undefined) data.facebookUrl = input.facebookUrl;
    if (input.email !== undefined) data.email = input.email;
    if (input.address !== undefined) data.address = input.address;
    if (input.googleMapsUrl !== undefined)
      data.googleMapsUrl = input.googleMapsUrl;
    return data;
  }
}
