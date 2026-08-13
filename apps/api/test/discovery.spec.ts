import { describe, expect, it } from "vitest";

import { createCampaignSchema } from "../src/campaigns/campaign.schemas";
import { parseGooglePlacesPage } from "../src/discovery/google-places.provider";
import { MockPlacesProvider } from "../src/discovery/mock-places.provider";

describe("business discovery", () => {
  it("produces deterministic local results without external API calls", async () => {
    const provider = new MockPlacesProvider();
    const results = await provider.search({
      country: "US",
      state: "Kansas",
      city: "Wichita",
      postalCode: null,
      radiusMeters: 25_000,
      niche: "plumber",
      keyword: null,
      maximumResults: 2,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      googlePlaceId: "mock-wichita-plumber-1",
      name: "Wichita Premier Plumber",
    });
    expect(results[1]?.websiteUrl).toBeNull();
  });

  it("rejects campaigns that exclude every website category", () => {
    const result = createCampaignSchema.safeParse({
      name: "Wichita plumbers",
      country: "US",
      city: "Wichita",
      niche: "plumber",
      includeWithWebsites: false,
      includeWithoutWebsites: false,
    });

    expect(result.success).toBe(false);
  });

  it("keeps usable Google Places results when some listings have messy URLs", () => {
    const parsed = parseGooglePlacesPage({
      places: [
        {
          id: "places/ChIJ-good",
          displayName: { text: "Mesa Pressure Pros" },
          formattedAddress: "Mesa, AZ",
          location: { latitude: 33.4, longitude: -111.8 },
          websiteUri: "www.mesapressure.com",
          googleMapsUri: "https://maps.google.com/?cid=1",
        },
        {
          id: "broken",
          displayName: {},
        },
        {
          id: "ChIJ-no-site",
          displayName: { text: "Desert Wash" },
          shortFormattedAddress: "Mesa",
          websiteUri: "",
          rating: 4.6,
          userRatingCount: 12.0,
        },
      ],
      nextPageToken: "abc",
    });

    expect(parsed.skipped).toBe(1);
    expect(parsed.places).toHaveLength(2);
    expect(parsed.places[0]?.id).toBe("places/ChIJ-good");
    expect(parsed.nextPageToken).toBe("abc");
  });
});
