import {
  Body,
  Controller,
  Get,
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
  businessListQuerySchema,
  markDmSchema,
  setRepliedSchema,
  updateBusinessSchema,
  type BusinessListQuery,
  type MarkDmInput,
  type SetRepliedInput,
  type UpdateBusinessInput,
} from "./business.schemas";
import { BusinessesService } from "./businesses.service";
import { OutreachService } from "./outreach.service";

@Controller("businesses")
@UseGuards(AccessTokenGuard)
export class BusinessesController {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly outreach: OutreachService,
  ) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(businessListQuerySchema)) query: BusinessListQuery,
  ) {
    return this.businesses.list(request.auth.organizationId, query);
  }

  /** Creates/refreshes fake leads for Gmail send testing. */
  @Post("test-email-leads")
  ensureTestEmailLeads(@Req() request: AuthenticatedRequest) {
    return this.businesses.ensureTestEmailLeads(
      request.auth.organizationId,
      request.auth.sub,
    );
  }

  @Get(":id")
  get(@Req() request: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.businesses.get(request.auth.organizationId, id);
  }

  @Patch(":id")
  update(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBusinessSchema)) input: UpdateBusinessInput,
  ) {
    return this.businesses.update(request.auth.organizationId, id, input);
  }

  @Post(":id/scrape-instagram")
  scrapeInstagram(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.businesses.scrapeInstagram(request.auth.organizationId, id);
  }

  @Post(":id/find-socials")
  findSocials(@Req() request: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.businesses.findSocials(request.auth.organizationId, id);
  }

  @Post(":id/mark-dm")
  markDm(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(markDmSchema)) input: MarkDmInput,
  ) {
    return this.outreach.markDm(
      request.auth.organizationId,
      request.auth.sub,
      id,
      new Date(input.dayStart),
    );
  }

  @Post(":id/send-email")
  sendEmail(@Req() request: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.outreach.sendOfferEmail(
      request.auth.organizationId,
      request.auth.sub,
      id,
    );
  }

  @Post(":id/replied")
  setReplied(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setRepliedSchema)) input: SetRepliedInput,
  ) {
    return this.outreach.setReplied(
      request.auth.organizationId,
      request.auth.sub,
      id,
      input.replied,
    );
  }
}
