import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DiscoveryModule } from "../discovery/discovery.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

@Module({
  imports: [AuthModule, DiscoveryModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
