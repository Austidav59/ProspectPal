import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { SearchSource } from "../generated/prisma";

import type { Environment } from "../config/environment";
import type {
  DiscoveredBusiness,
  DiscoveryProvider,
  DiscoveryQuery,
} from "./discovery.types";
import { MapsScraperProvider } from "./maps-scraper.provider";
import { MockPlacesProvider } from "./mock-places.provider";

@Injectable()
export class DiscoveryProviderService implements DiscoveryProvider {
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly maps: MapsScraperProvider,
    private readonly mock: MockPlacesProvider,
  ) {}

  get source(): SearchSource {
    return this.providerName === "maps" ? SearchSource.MAPS_SCRAPER : SearchSource.MOCK;
  }

  search(query: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
    return this.providerName === "maps" ? this.maps.search(query) : this.mock.search(query);
  }

  private get providerName(): "maps" | "mock" {
    return this.config.getOrThrow<"maps" | "mock">("BUSINESS_DISCOVERY_PROVIDER");
  }
}
