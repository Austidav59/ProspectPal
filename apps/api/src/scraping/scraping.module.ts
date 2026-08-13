import { Module } from "@nestjs/common";

import { InstagramScraperService } from "./instagram-scraper.service";
import { SocialSearchService } from "./social-search.service";

@Module({
  providers: [InstagramScraperService, SocialSearchService],
  exports: [InstagramScraperService, SocialSearchService],
})
export class ScrapingModule {}
