import { Module } from "@nestjs/common";

import { LeadPoolService } from "../leads/lead-pool.service";
import { ScrapingModule } from "../scraping/scraping.module";
import { DiscoveryJobsService } from "./discovery-jobs.service";
import { DiscoveryProcessor } from "./discovery.processor";
import { DiscoveryProviderService } from "./discovery-provider.service";
import { GooglePlacesProvider } from "./google-places.provider";
import { MockPlacesProvider } from "./mock-places.provider";

@Module({
  imports: [ScrapingModule],
  providers: [
    DiscoveryJobsService,
    DiscoveryProcessor,
    DiscoveryProviderService,
    GooglePlacesProvider,
    MockPlacesProvider,
    LeadPoolService,
  ],
  exports: [DiscoveryJobsService, DiscoveryProviderService, LeadPoolService],
})
export class DiscoveryModule {}
