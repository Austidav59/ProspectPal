import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { SearchSource } from "../generated/prisma";

import type { Environment } from "../config/environment";
import type {
  DiscoveredBusiness,
  DiscoveryProvider,
  DiscoveryQuery,
} from "./discovery.types";
import { GooglePlacesProvider } from "./google-places.provider";
import { MockPlacesProvider } from "./mock-places.provider";

@Injectable()
export class DiscoveryProviderService implements DiscoveryProvider {
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly google: GooglePlacesProvider,
    private readonly mock: MockPlacesProvider,
  ) {}

  get source(): SearchSource {
    return this.providerName === "google" ? SearchSource.GOOGLE_PLACES : SearchSource.MOCK;
  }

  search(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    return this.providerName === "google" ? this.google.search(query) : this.mock.search(query);
  }

  private get providerName(): "google" | "mock" {
    return this.config.getOrThrow<"google" | "mock">("BUSINESS_DISCOVERY_PROVIDER");
  }
}
