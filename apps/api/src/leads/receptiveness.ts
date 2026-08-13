export interface ReceptivenessInput {
  websiteUrl: string | null;
  instagramUrl?: string | null;
  email?: string | null;
  rating: number | null;
  reviewCount: number | null;
  businessStatus: string;
  timesServed?: number;
}

export interface ReceptivenessResult {
  score: number;
  reasons: string[];
  label: "Strong fit" | "Good fit" | "Fair fit" | "Weak fit";
}

/**
 * Scores how likely a business is to accept an SEO / website outreach offer.
 * Higher = better cold lead. Top Google rankers are excluded separately.
 */
export function scoreReceptiveness(input: ReceptivenessInput): ReceptivenessResult {
  let score = 40;
  const reasons: string[] = [];

  if (input.businessStatus === "CLOSED_PERMANENTLY") {
    return { score: 0, reasons: ["Permanently closed"], label: "Weak fit" };
  }

  if (!input.websiteUrl) {
    score += 30;
    reasons.push("No website — strong offer fit");
  } else if (!input.instagramUrl) {
    score += 15;
    reasons.push("Has a website but weak social presence");
  } else {
    score += 5;
    reasons.push("Has a website and Instagram");
  }

  const reviews = input.reviewCount;
  if (reviews !== null && reviews !== undefined) {
    if (reviews >= 5 && reviews <= 40) {
      score += 15;
      reasons.push(`${reviews} reviews — established but not saturated`);
    } else if (reviews >= 41 && reviews <= 120) {
      score += 8;
      reasons.push(`${reviews} reviews — mid-size local business`);
    } else if (reviews > 200) {
      score -= 15;
      reasons.push(`${reviews} reviews — likely already has marketing`);
    } else if (reviews < 5) {
      score += 5;
      reasons.push("Very few reviews — early-stage presence");
    }
  }

  const rating = input.rating;
  if (rating !== null && rating !== undefined) {
    if (rating >= 3.5 && rating <= 4.7) {
      score += 10;
      reasons.push(`Rating ${rating.toFixed(1)} — solid with room to improve`);
    } else if (rating < 3.0) {
      score -= 5;
      reasons.push(`Low rating (${rating.toFixed(1)})`);
    }
  }

  if (input.instagramUrl) {
    score += 10;
    reasons.push("Instagram available to DM");
  } else if (input.email) {
    score += 5;
    reasons.push("Email available for outreach");
  }

  const served = input.timesServed ?? 0;
  if (served > 50) {
    score -= 20;
    reasons.push("Served many times already — deprioritized");
  } else if (served > 20) {
    score -= 10;
    reasons.push("Served often — spreading inventory");
  }

  score = Math.max(0, Math.min(100, score));
  const label =
    score >= 75 ? "Strong fit" : score >= 55 ? "Good fit" : score >= 35 ? "Fair fit" : "Weak fit";

  return { score, reasons, label };
}

export function normalizeMarketKey(city: string, state: string | null): string {
  const cityPart = city.trim().toLowerCase().replace(/\s+/g, "_");
  const statePart = (state ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return statePart ? `${cityPart}_${statePart}` : cityPart;
}

export function normalizeCategoryKey(niche: string): string {
  return niche
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function buildSearchKey(marketKey: string, categoryKey: string): string {
  return `${marketKey}|${categoryKey}`;
}

export const LEAD_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 30 * 6; // ~6 months
export const MIN_AVAILABLE_BEFORE_REFRESH = 15;
