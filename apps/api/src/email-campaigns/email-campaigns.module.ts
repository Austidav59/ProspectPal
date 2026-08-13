import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DiscoveryModule } from "../discovery/discovery.module";
import { EmailModule } from "../email/email.module";
import { SettingsModule } from "../settings/settings.module";
import { EmailCampaignsController } from "./email-campaigns.controller";
import { EmailCampaignsService } from "./email-campaigns.service";

@Module({
  imports: [AuthModule, EmailModule, SettingsModule, DiscoveryModule],
  controllers: [EmailCampaignsController],
  providers: [EmailCampaignsService],
})
export class EmailCampaignsModule {}
