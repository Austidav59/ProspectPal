import { describe, expect, it } from "vitest";

import { scoreReceptiveness } from "../src/leads/receptiveness";

describe("scoreReceptiveness", () => {
  it("scores no-website businesses as strong outreach targets", () => {
    const result = scoreReceptiveness({
      websiteUrl: null,
      instagramUrl: "https://www.instagram.com/test/",
      rating: 4.2,
      reviewCount: 18,
      businessStatus: "OPERATIONAL",
    });
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.label).toBe("Strong fit");
    expect(result.reasons.some((reason) => reason.includes("No website"))).toBe(true);
  });

  it("downranks businesses with huge review counts", () => {
    const result = scoreReceptiveness({
      websiteUrl: "https://example.com",
      instagramUrl: "https://www.instagram.com/test/",
      rating: 4.9,
      reviewCount: 400,
      businessStatus: "OPERATIONAL",
      timesServed: 0,
    });
    expect(result.score).toBeLessThan(75);
    expect(result.reasons.some((reason) => reason.includes("already has marketing"))).toBe(true);
  });
});
