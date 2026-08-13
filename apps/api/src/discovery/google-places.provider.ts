import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

import type { Environment } from "../config/environment";
import type {
  DiscoveredBusiness,
  DiscoveryProvider,
  DiscoveryQuery,
} from "./discovery.types";

const PAGE_TOKEN_DELAY_MS = 2_000;
const MAX_GOOGLE_PAGES = 3;
const PAGE_DEADLINE_MS = 18_000;

const loosePlaceSchema = z
  .object({
    id: z.string().min(1),
    displayName: z
      .object({ text: z.string().min(1) })
      .passthrough(),
    primaryType: z.string().optional(),
    formattedAddress: z.string().optional(),
    shortFormattedAddress: z.string().optional(),
    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
      })
      .optional(),
    nationalPhoneNumber: z.string().optional(),
    websiteUri: z.string().optional(),
    rating: z.number().optional(),
    userRatingCount: z.number().optional(),
    googleMapsUri: z.string().optional(),
    businessStatus: z.string().optional(),
  })
  .passthrough();

const placesResponseSchema = z
  .object({
    places: z.array(z.unknown()).optional().default([]),
    nextPageToken: z.string().optional(),
  })
  .passthrough();

type LoosePlace = z.infer<typeof loosePlaceSchema>;

function asUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

function placeId(raw: string): string {
  return raw.startsWith("places/") ? raw.slice("places/".length) : raw;
}

export function parseGooglePlacesPage(payload: unknown): {
  places: LoosePlace[];
  nextPageToken?: string;
  skipped: number;
} {
  const parsed = placesResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ServiceUnavailableException(
      `Google Places returned an unexpected response: ${parsed.error.issues[0]?.message ?? "invalid JSON"}`,
    );
  }

  const places: LoosePlace[] = [];
  let skipped = 0;
  for (const raw of parsed.data.places) {
    const place = loosePlaceSchema.safeParse(raw);
    if (!place.success) {
      skipped += 1;
      continue;
    }
    places.push(place.data);
  }

  return {
    places,
    ...(parsed.data.nextPageToken ? { nextPageToken: parsed.data.nextPageToken } : {}),
    skipped,
  };
}

@Injectable()
export class GooglePlacesProvider implements DiscoveryProvider {
  private readonly logger = new Logger(GooglePlacesProvider.name);
  private static readonly endpoint = "https://places.googleapis.com/v1/places:searchText";
  private static readonly fieldMask = [
    "places.id",
    "places.displayName",
    "places.primaryType",
    "places.formattedAddress",
    "places.shortFormattedAddress",
    "places.location",
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "places.rating",
    "places.userRatingCount",
    "places.googleMapsUri",
    "places.businessStatus",
    "nextPageToken",
  ].join(",");

  constructor(private readonly config: ConfigService<Environment, true>) {}

  async search(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    const results: DiscoveredBusiness[] = [];
    let pageToken: string | undefined;
    let page = 0;
    const seenPageTokens = new Set<string>();

    do {
      if (pageToken) {
        if (seenPageTokens.has(pageToken)) {
          this.logger.warn("Google Places repeated a page token; stopping pagination");
          break;
        }
        seenPageTokens.add(pageToken);
        await new Promise((resolve) => setTimeout(resolve, PAGE_TOKEN_DELAY_MS));
      }
      const remaining = query.maximumResults - results.length;
      const response = await this.fetchPageWithDeadline(
        query,
        Math.min(20, remaining),
        pageToken,
      );
      page += 1;
      if (response.skipped > 0) {
        this.logger.warn(
          `Skipped ${response.skipped} unusable Google Places result(s) on page ${page}`,
        );
      }
      const previousCount = results.length;
      results.push(...response.places.map((place) => this.normalize(place)));
      pageToken = response.nextPageToken;
      if (results.length === previousCount) {
        this.logger.warn("Google Places returned an empty page; stopping pagination");
        break;
      }
    } while (
      pageToken &&
      results.length < query.maximumResults &&
      page < MAX_GOOGLE_PAGES
    );

    this.logger.log(
      `Google Places returned ${results.length} businesses for "${query.niche}" in ${query.city}`,
    );
    return results.slice(0, query.maximumResults);
  }

  private async fetchPageWithDeadline(
    query: DiscoveryQuery,
    pageSize: number,
    pageToken?: string,
  ) {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.fetchPage(query, pageSize, pageToken),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ServiceUnavailableException("Google Places page timed out")),
            PAGE_DEADLINE_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async fetchPage(query: DiscoveryQuery, pageSize: number, pageToken?: string) {
    const location = [query.city, query.state, query.postalCode, query.country]
      .filter((part): part is string => Boolean(part))
      .join(", ");
    const body: {
      textQuery: string;
      pageSize: number;
      pageToken?: string;
      languageCode: string;
    } = {
      textQuery: `${query.keyword ?? query.niche} in ${location}`,
      pageSize,
      languageCode: "en",
    };
    if (pageToken) body.pageToken = pageToken;

    let response: Response;
    try {
      response = await fetch(GooglePlacesProvider.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.config.getOrThrow<string>("GOOGLE_PLACES_API_KEY"),
          "X-Goog-FieldMask": GooglePlacesProvider.fieldMask,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.logger.error(`Google Places request failed: ${message}`);
      throw new ServiceUnavailableException("Google Places could not be reached");
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof (payload as { error?: { message?: string } }).error?.message === "string"
          ? (payload as { error: { message: string } }).error.message
          : `HTTP ${response.status}`;
      this.logger.error(`Google Places error: ${detail}`);
      throw new ServiceUnavailableException(`Google Places returned ${detail}`);
    }

    return parseGooglePlacesPage(payload);
  }

  private normalize(place: LoosePlace): DiscoveredBusiness {
    const id = placeId(place.id);
    const address = place.formattedAddress?.trim() || place.shortFormattedAddress?.trim() || "Address unavailable";
    return {
      googlePlaceId: id,
      externalProviderId: id,
      name: place.displayName.text,
      primaryCategory: place.primaryType ?? null,
      categories: place.primaryType ? [place.primaryType] : [],
      phone: place.nationalPhoneNumber ?? null,
      websiteUrl: asUrl(place.websiteUri),
      address,
      latitude: place.location?.latitude ?? 0,
      longitude: place.location?.longitude ?? 0,
      googleMapsUrl: asUrl(place.googleMapsUri),
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount !== undefined ? Math.round(place.userRatingCount) : null,
      businessStatus: place.businessStatus ?? "BUSINESS_STATUS_UNSPECIFIED",
      rawData: {
        id,
        name: place.displayName.text,
        primaryType: place.primaryType ?? null,
        formattedAddress: address,
        latitude: place.location?.latitude ?? 0,
        longitude: place.location?.longitude ?? 0,
        phone: place.nationalPhoneNumber ?? null,
        websiteUri: asUrl(place.websiteUri),
        rating: place.rating ?? null,
        userRatingCount: place.userRatingCount ?? null,
        googleMapsUri: asUrl(place.googleMapsUri),
        businessStatus: place.businessStatus ?? null,
      },
    };
  }
}
