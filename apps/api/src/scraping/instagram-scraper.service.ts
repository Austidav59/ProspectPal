import { Injectable, Logger } from "@nestjs/common";
import * as cheerio from "cheerio";

import {
  extractEmail,
  extractFacebookUrl,
  extractInstagramUrl,
} from "./scraping.utils";

export interface WebsiteScanResult {
  instagramUrl: string | null;
  facebookUrl: string | null;
  email: string | null;
}

const MAX_PAGES_PER_SITE = 12;
const CRAWL_CONCURRENCY = 3;
const RELEVANT_PATH =
  /(contact|about|team|staff|support|privacy|terms|company|connect)/i;
const SKIPPED_FILE =
  /\.(?:avif|css|csv|docx?|gif|ico|jpe?g|js|json|mp4|pdf|png|svg|webp|xlsx?|xml)$/i;

interface CrawledPage {
  html: string;
  finalUrl: string;
}

interface QueuedUrl {
  url: string;
  priority: number;
}

@Injectable()
export class InstagramScraperService {
  private readonly logger = new Logger(InstagramScraperService.name);

  /**
   * Crawls the most useful pages on a business site and extracts contact data.
   * The crawl is bounded so a broken or very large site cannot block the queue.
   */
  async scanWebsite(websiteUrl: string): Promise<WebsiteScanResult> {
    let root: URL;
    try {
      root = new URL(websiteUrl);
    } catch {
      return { instagramUrl: null, facebookUrl: null, email: null };
    }

    let instagramUrl: string | null = null;
    let facebookUrl: string | null = null;
    let email: string | null = null;
    const visited = new Set<string>();
    const queued = new Set<string>();
    const queue: QueuedUrl[] = [];

    const enqueue = (raw: string, priority: number) => {
      const normalized = this.normalizeInternalUrl(raw, root);
      if (!normalized || visited.has(normalized) || queued.has(normalized))
        return;
      if (queue.length >= 60) return;
      queued.add(normalized);
      queue.push({ url: normalized, priority });
    };

    enqueue(root.toString(), 1_000);
    for (const path of ["/contact", "/contact-us", "/about", "/about-us"]) {
      enqueue(new URL(path, root).toString(), 80);
    }

    const sitemapUrls = await this.readSitemap(root);
    for (const url of sitemapUrls) {
      enqueue(url, RELEVANT_PATH.test(url) ? 90 : 5);
    }

    while (
      queue.length > 0 &&
      visited.size < MAX_PAGES_PER_SITE &&
      (!instagramUrl || !facebookUrl || !email)
    ) {
      queue.sort((a, b) => b.priority - a.priority);
      const batch = queue.splice(
        0,
        Math.min(CRAWL_CONCURRENCY, MAX_PAGES_PER_SITE - visited.size),
      );
      for (const item of batch) {
        queued.delete(item.url);
        visited.add(item.url);
      }

      const pages = await Promise.all(
        batch.map((item) => this.fetchPage(item.url)),
      );
      for (const page of pages) {
        if (!page) continue;
        const $ = cheerio.load(page.html);
        const hrefs = $("a[href]")
          .map((_, element) => $(element).attr("href") ?? "")
          .get();
        const searchable = `${page.html}\n${$.root().text()}\n${hrefs.join("\n")}`;

        instagramUrl ??= extractInstagramUrl(searchable);
        facebookUrl ??= extractFacebookUrl(searchable);
        email ??= extractEmail(searchable);

        $("a[href]").each((_, element) => {
          const href = $(element).attr("href");
          if (!href) return;
          const label = $(element).text();
          const priority = RELEVANT_PATH.test(`${href} ${label}`) ? 100 : 10;
          try {
            enqueue(new URL(href, page.finalUrl).toString(), priority);
          } catch {
            // Ignore malformed links.
          }
        });
      }
    }

    this.logger.debug(
      `Scanned ${visited.size} page(s) on ${root.hostname}: ` +
        `instagram=${Boolean(instagramUrl)} facebook=${Boolean(facebookUrl)} email=${Boolean(email)}`,
    );
    return { instagramUrl, facebookUrl, email };
  }

  async findInstagramUrl(websiteUrl: string): Promise<string | null> {
    const result = await this.scanWebsite(websiteUrl);
    return result.instagramUrl;
  }

  private normalizeInternalUrl(raw: string, root: URL): string | null {
    try {
      const url = new URL(raw, root);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      if (
        url.hostname.replace(/^www\./, "") !==
        root.hostname.replace(/^www\./, "")
      ) {
        return null;
      }
      if (SKIPPED_FILE.test(url.pathname)) return null;
      url.hash = "";
      url.search = "";
      return (
        url.toString().replace(/\/$/, "") || `${url.protocol}//${url.host}`
      );
    } catch {
      return null;
    }
  }

  private async readSitemap(root: URL): Promise<string[]> {
    const page = await this.fetchPage(new URL("/sitemap.xml", root).toString());
    if (!page) return [];
    const urls = new Set<string>();
    for (const match of page.html.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
      const raw = match[1]?.replaceAll("&amp;", "&");
      if (!raw) continue;
      const normalized = this.normalizeInternalUrl(raw, root);
      if (normalized) urls.add(normalized);
      if (urls.size >= 40) break;
    }
    return [...urls];
  }

  private async fetchPage(websiteUrl: string): Promise<CrawledPage | null> {
    try {
      const response = await fetch(websiteUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml,text/xml",
        },
      });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !/(?:html|xml|text\/plain)/i.test(contentType)) {
        return null;
      }
      return {
        html: await response.text(),
        finalUrl: response.url || websiteUrl,
      };
    } catch (error: unknown) {
      this.logger.debug(
        `Could not fetch ${websiteUrl}: ${error instanceof Error ? error.message : "unknown"}`,
      );
      return null;
    }
  }
}
