import { createHash } from "node:crypto";

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { Environment } from "../config/environment";
import type {
  DiscoveredBusiness,
  DiscoveryProvider,
  DiscoveryQuery,
  JsonValue,
} from "./discovery.types";

const POLL_INTERVAL_MS = 5_000;

interface ScraperJob {
  ID?: string;
  id?: string;
  Status?: string;
  status?: string;
}

interface ScraperRow {
  title: string;
  place_id: string;
  cid: string;
  category: string;
  address: string;
  website: string;
  phone: string;
  latitude: string;
  longitude: string;
  review_rating: string;
  review_count: string;
  link: string;
  status: string;
}

@Injectable()
export class MapsScraperProvider implements DiscoveryProvider {
  private readonly logger = new Logger(MapsScraperProvider.name);

  constructor(private readonly config: ConfigService<Environment, true>) {}

  async search(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    const baseUrl = this.config.getOrThrow<string>("MAPS_SCRAPER_URL").replace(/\/$/, "");
    const keyword = this.buildKeyword(query);
    const depth = this.resolveDepth(query.maximumResults);
    const maxTimeSeconds = this.config.get("MAPS_SCRAPER_MAX_TIME_SECONDS", {
      infer: true,
    });
    const proxies = this.parseProxies(
      this.config.get("MAPS_SCRAPER_PROXIES", { infer: true }),
    );

    this.logger.log(
      `Starting Maps scrape for "${keyword}" (depth=${depth}, max=${query.maximumResults})`,
    );

    const jobId = await this.createJob(baseUrl, {
      Name: `prospectpal-${Date.now()}`,
      keywords: [keyword],
      lang: "en",
      zoom: 14,
      lat: "",
      lon: "",
      fast_mode: false,
      radius: Math.max(1_000, Math.round(query.radiusMeters || 10_000)),
      depth,
      email: false,
      extra_reviews: false,
      max_time: maxTimeSeconds,
      proxies,
    });

    await this.waitForJob(baseUrl, jobId, maxTimeSeconds);
    const rows = await this.downloadRows(baseUrl, jobId);
    const results = rows
      .map((row) => this.normalize(row))
      .filter((row): row is DiscoveredBusiness => row !== null)
      .slice(0, query.maximumResults);

    this.logger.log(
      `Maps scraper returned ${results.length} businesses for "${query.niche}" in ${query.city}`,
    );
    return results;
  }

  private buildKeyword(query: DiscoveryQuery): string {
    const location = [query.city, query.state, query.postalCode, query.country]
      .filter((part): part is string => Boolean(part))
      .join(", ");
    return `${query.keyword ?? query.niche} in ${location}`;
  }

  private resolveDepth(maximumResults: number): number {
    const configured = this.config.get("MAPS_SCRAPER_DEPTH", { infer: true });
    if (configured) return configured;
    return Math.min(10, Math.max(1, Math.ceil(maximumResults / 20)));
  }

  private parseProxies(raw: string | undefined): string[] {
    if (!raw?.trim()) return [];
    return raw
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private async createJob(
    baseUrl: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.logger.error(`Maps scraper create job failed: ${message}`);
      throw new ServiceUnavailableException(
        "Maps scraper could not be reached. Is docker compose maps-scraper running?",
      );
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = this.errorMessage(payload, response.status);
      this.logger.error(`Maps scraper rejected job: ${detail}`);
      throw new ServiceUnavailableException(`Maps scraper rejected job: ${detail}`);
    }

    const id =
      typeof payload === "object" &&
      payload !== null &&
      "id" in payload &&
      typeof (payload as { id: unknown }).id === "string"
        ? (payload as { id: string }).id
        : null;
    if (!id) {
      throw new ServiceUnavailableException("Maps scraper did not return a job id");
    }
    return id;
  }

  private async waitForJob(
    baseUrl: string,
    jobId: string,
    maxTimeSeconds: number,
  ): Promise<void> {
    const deadline = Date.now() + (maxTimeSeconds + 120) * 1_000;

    while (Date.now() < deadline) {
      const job = await this.fetchJob(baseUrl, jobId);
      const status = (job.Status ?? job.status ?? "").toLowerCase();
      if (status === "ok") return;
      if (status === "failed") {
        throw new ServiceUnavailableException(`Maps scraper job ${jobId} failed`);
      }
      await sleep(POLL_INTERVAL_MS);
    }

    throw new ServiceUnavailableException(
      `Maps scraper job ${jobId} timed out after ${maxTimeSeconds}s`,
    );
  }

  private async fetchJob(baseUrl: string, jobId: string): Promise<ScraperJob> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/jobs/${jobId}`, {
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new ServiceUnavailableException(`Maps scraper poll failed: ${message}`);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Maps scraper poll error: ${this.errorMessage(payload, response.status)}`,
      );
    }
    return (payload ?? {}) as ScraperJob;
  }

  private async downloadRows(baseUrl: string, jobId: string): Promise<ScraperRow[]> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/jobs/${jobId}/download`, {
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new ServiceUnavailableException(`Maps scraper download failed: ${message}`);
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Maps scraper download error: HTTP ${response.status}`,
      );
    }

    const csv = await response.text();
    return parseCsv(csv).map((row) => ({
      title: row.title ?? "",
      place_id: row.place_id ?? "",
      cid: row.cid ?? "",
      category: row.category ?? "",
      address: row.address ?? row.complete_address ?? "",
      website: row.website ?? "",
      phone: row.phone ?? "",
      latitude: row.latitude ?? "",
      longitude: row.longitude ?? row.longtitude ?? "",
      review_rating: row.review_rating ?? "",
      review_count: row.review_count ?? "",
      link: row.link ?? "",
      status: row.status ?? "",
    }));
  }

  private normalize(row: ScraperRow): DiscoveredBusiness | null {
    const name = row.title.trim();
    if (!name) return null;

    const placeId =
      row.place_id.trim() ||
      row.cid.trim() ||
      `maps-${createHash("sha1").update(`${name}|${row.address}`).digest("hex").slice(0, 24)}`;

    const websiteUrl = asUrl(row.website);
    const googleMapsUrl = asUrl(row.link);
    const address = row.address.trim() || "Address unavailable";
    const rating = parseOptionalNumber(row.review_rating);
    const reviewCountRaw = parseOptionalNumber(row.review_count);
    const reviewCount =
      reviewCountRaw === null ? null : Math.max(0, Math.round(reviewCountRaw));
    const latitude = parseOptionalNumber(row.latitude) ?? 0;
    const longitude = parseOptionalNumber(row.longitude) ?? 0;
    const primaryCategory = row.category.trim() || null;
    const businessStatus = mapBusinessStatus(row.status);

    const rawData: { [key: string]: JsonValue } = {
      source: "maps-scraper",
      place_id: placeId,
      title: name,
      category: primaryCategory,
      address,
      website: websiteUrl,
      phone: row.phone.trim() || null,
      latitude,
      longitude,
      rating,
      review_count: reviewCount,
      link: googleMapsUrl,
      status: row.status.trim() || null,
      cid: row.cid.trim() || null,
    };

    return {
      googlePlaceId: placeId,
      externalProviderId: placeId,
      name,
      primaryCategory,
      categories: primaryCategory ? [primaryCategory] : [],
      phone: row.phone.trim() || null,
      websiteUrl,
      address,
      latitude,
      longitude,
      googleMapsUrl,
      rating,
      reviewCount,
      businessStatus,
      rawData,
    };
  }

  private errorMessage(payload: unknown, status: number): string {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof (payload as { message: unknown }).message === "string"
    ) {
      return (payload as { message: string }).message;
    }
    return `HTTP ${status}`;
  }
}

function mapBusinessStatus(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return "OPERATIONAL";
  if (value.includes("permanently closed") || value === "closed") {
    return "CLOSED_PERMANENTLY";
  }
  if (value.includes("temporarily closed")) {
    return "CLOSED_TEMPORARILY";
  }
  return "OPERATIONAL";
}

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

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((header) => header.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      const key = headers[index];
      if (!key) continue;
      record[key] = cells[index] ?? "";
    }
    return record;
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  return rows;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
