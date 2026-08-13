import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  audiencePreviewQuerySchema,
  createEmailCampaignSchema,
  emailCampaignListQuerySchema,
  type AudiencePreviewQuery,
  type CreateEmailCampaignInput,
  type EmailCampaignListQuery,
} from "./email-campaign.schemas";
import { EmailCampaignsService } from "./email-campaigns.service";

@Controller("email-campaigns")
@UseGuards(AccessTokenGuard)
export class EmailCampaignsController {
  constructor(private readonly campaigns: EmailCampaignsService) {}

  @Get("status")
  status() {
    return this.campaigns.status();
  }

  @Get("templates")
  templates() {
    return this.campaigns.templates();
  }

  @Get("audience")
  audience(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(audiencePreviewQuerySchema)) query: AudiencePreviewQuery,
  ) {
    return this.campaigns.previewAudience(request.auth.organizationId, query);
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(emailCampaignListQuerySchema)) query: EmailCampaignListQuery,
  ) {
    return this.campaigns.list(request.auth.organizationId, query);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createEmailCampaignSchema)) input: CreateEmailCampaignInput,
  ) {
    return this.campaigns.create(request.auth.organizationId, input);
  }

  @Get(":id")
  get(@Req() request: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.campaigns.get(request.auth.organizationId, id);
  }

  @Post(":id/start")
  start(@Req() request: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.campaigns.start(request.auth.organizationId, request.auth.sub, id);
  }
}
