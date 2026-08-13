import { Injectable } from "@nestjs/common";

import type {
  DiscoveredBusiness,
  DiscoveryProvider,
  DiscoveryQuery,
} from "./discovery.types";

@Injectable()
export class MockPlacesProvider implements DiscoveryProvider {
  search(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    const niche = this.titleCase(query.niche);
    const citySlug = query.city.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const nicheSlug = query.niche.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const businesses: DiscoveredBusiness[] = [
      this.business(query, {
        id: `mock-${citySlug}-${nicheSlug}-1`,
        name: `${query.city} Premier ${niche}`,
        reviews: 47,
        rating: 4.8,
        website: `https://${citySlug}-${nicheSlug}.example`,
      }),
      this.business(query, {
        id: `mock-${citySlug}-${nicheSlug}-2`,
        name: `Family ${niche} Co.`,
        reviews: 23,
        rating: 4.5,
        website: null,
      }),
      this.business(query, {
        id: `mock-${citySlug}-${nicheSlug}-3`,
        name: `Northside ${niche}`,
        reviews: 8,
        rating: 4.1,
        website: `https://northside-${nicheSlug}.example`,
      }),
    ];

    return Promise.resolve(businesses.slice(0, query.maximumResults));
  }

  private business(
    query: DiscoveryQuery,
    values: {
      id: string;
      name: string;
      reviews: number;
      rating: number;
      website: string | null;
    },
  ): DiscoveredBusiness {
    const address = `100 Market St, ${query.city}${query.state ? `, ${query.state}` : ""}`;
    const rawData = {
      id: values.id,
      displayName: { text: values.name },
      formattedAddress: address,
      websiteUri: values.website,
      rating: values.rating,
      userRatingCount: values.reviews,
      source: "local-development-mock",
    };

    return {
      googlePlaceId: values.id,
      externalProviderId: values.id,
      name: values.name,
      primaryCategory: query.niche,
      categories: [query.niche],
      phone: "+1 555-0100",
      websiteUrl: values.website,
      address,
      latitude: 37.6872,
      longitude: -97.3301,
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query_place_id=${values.id}`,
      rating: values.rating,
      reviewCount: values.reviews,
      businessStatus: "OPERATIONAL",
      rawData,
    };
  }

  private titleCase(value: string): string {
    return value
      .split(/\s+/)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
      .join(" ");
  }
}
