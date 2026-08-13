import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  campaignListQuerySchema,
  createCampaignSchema,
  updateCampaignSchema,
  type CampaignListQuery,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from "./campaign.schemas";
import { CampaignsService } from "./campaigns.service";

@Controller("campaigns")
@UseGuards(AccessTokenGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(campaignListQuerySchema)) query: CampaignListQuery,
  ) {
    return this.campaigns.list(request.auth.organizationId, query);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createCampaignSchema)) input: CreateCampaignInput,
  ) {
    return this.campaigns.create(request.auth.organizationId, input);
  }

  @Get(":id")
  get(@Req() request: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.campaigns.get(request.auth.organizationId, id);
  }

  @Patch(":id")
  update(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema)) input: UpdateCampaignInput,
  ) {
    return this.campaigns.update(request.auth.organizationId, id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  archive(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.campaigns.archive(request.auth.organizationId, id);
  }

  @Post(":id/run")
  run(@Req() request: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.campaigns.run(request.auth.organizationId, id, request.auth.sub);
  }

  @Post(":id/pause")
  pause(@Req() request: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.campaigns.pause(request.auth.organizationId, id);
  }

  @Post(":id/unhide")
  unhide(@Req() request: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.campaigns.unhide(request.auth.organizationId, id);
  }
}
