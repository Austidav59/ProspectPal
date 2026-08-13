import { Injectable, Logger } from "@nestjs/common";

import { normalizeFacebookUrl, normalizeInstagramUrl } from "./scraping.utils";

export interface SocialSearchResult {
  instagramUrl: string | null;
  facebookUrl: string | null;
}

const WEBSITE_RESULT_BLOCKLIST = [
  "google.",
  "duckduckgo.",
  "instagram.com",
  "facebook.com",
  "linkedin.com",
  "yelp.com",
  "yellowpages.com",
  "mapquest.com",
  "bbb.org",
  "angi.com",
  "thumbtack.com",
];

/**
 * Finds Instagram / Facebook by searching the open web for
 * "business name + city + platform", then taking the first real profile URL.
 * Tries Google first, then DuckDuckGo if Google returns nothing or blocks us.
 */
@Injectable()
export class SocialSearchService {
  private readonly logger = new Logger(SocialSearchService.name);

  async findSocialProfiles(
    name: string,
    city: string,
  ): Promise<SocialSearchResult> {
    const [instagramUrl, facebookUrl] = await Promise.all([
      this.searchPlatform(name, city, "instagram", normalizeInstagramUrl),
      this.searchPlatform(name, city, "facebook", normalizeFacebookUrl),
    ]);
    return { instagramUrl, facebookUrl };
  }

  async findOfficialWebsite(
    name: string,
    city: string,
  ): Promise<string | null> {
    const query = `"${name}" ${city} official website`;
    const normalize = (raw: string) => this.normalizeWebsite(raw);
    const fromGoogle = await this.searchGoogle(query, normalize);
    if (fromGoogle) return fromGoogle;
    return this.searchDuckDuckGo(query, normalize);
  }

  private normalizeWebsite(raw: string): string | null {
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      if (
        WEBSITE_RESULT_BLOCKLIST.some((blocked) => hostname.includes(blocked))
      ) {
        return null;
      }
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  private async searchPlatform(
    name: string,
    city: string,
    platform: "instagram" | "facebook",
    normalize: (raw: string) => string | null,
  ): Promise<string | null> {
    const site = platform === "instagram" ? "instagram.com" : "facebook.com";
    const query = `"${name}" ${city} site:${site}`;

    const fromGoogle = await this.searchGoogle(query, normalize);
    if (fromGoogle) return fromGoogle;

    return this.searchDuckDuckGo(query, normalize);
  }

  private async searchGoogle(
    query: string,
    normalize: (raw: string) => string | null,
  ): Promise<string | null> {
    const html = await this.fetchHtml(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=10`,
    );
    if (!html) return null;

    // Google wraps destinations as /url?q=https://...&sa=...
    for (const match of html.matchAll(/\/url\?q=([^&"']+)/g)) {
      const encoded = match[1];
      if (!encoded) continue;
      let target: string;
      try {
        target = decodeURIComponent(encoded);
      } catch {
        continue;
      }
      if (target.includes("google.")) continue;
      const normalized = normalize(target);
      if (normalized) return normalized;
    }

    // Some result layouts put the raw URL in the snippet / cite tags.
    for (const match of html.matchAll(
      /https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com)\/[A-Za-z0-9_.\-/%]+/gi,
    )) {
      const normalized = normalize(match[0]);
      if (normalized) return normalized;
    }

    return null;
  }

  private async searchDuckDuckGo(
    query: string,
    normalize: (raw: string) => string | null,
  ): Promise<string | null> {
    const html = await this.fetchHtml(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    );
    if (!html) return null;

    // DuckDuckGo wraps destinations in a uddg= redirect param.
    for (const match of html.matchAll(/uddg=([^&"']+)/g)) {
      const encoded = match[1];
      if (!encoded) continue;
      let target: string;
      try {
        target = decodeURIComponent(encoded);
      } catch {
        continue;
      }
      const normalized = normalize(target);
      if (normalized) return normalized;
    }
    return null;
  }

  private async fetchHtml(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!response.ok) {
        this.logger.debug(`Search ${url} returned status ${response.status}`);
        return null;
      }
      return await response.text();
    } catch (error: unknown) {
      this.logger.debug(
        `Search fetch failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return null;
    }
  }
}
