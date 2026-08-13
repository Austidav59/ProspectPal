import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DiscoveryModule } from "../discovery/discovery.module";
import { EmailModule } from "../email/email.module";
import { ScrapingModule } from "../scraping/scraping.module";
import { SettingsModule } from "../settings/settings.module";
import { BusinessesController } from "./businesses.controller";
import { BusinessesService } from "./businesses.service";
import { OutreachController } from "./outreach.controller";
import { OutreachService } from "./outreach.service";

@Module({
  imports: [AuthModule, ScrapingModule, SettingsModule, DiscoveryModule, EmailModule],
  controllers: [BusinessesController, OutreachController],
  providers: [BusinessesService, OutreachService],
})
export class BusinessesModule {}
