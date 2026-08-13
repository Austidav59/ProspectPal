import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";

import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  outreachSummaryQuerySchema,
  type OutreachSummaryQuery,
} from "./business.schemas";
import { OutreachService } from "./outreach.service";

@Controller("outreach")
@UseGuards(AccessTokenGuard)
export class OutreachController {
  constructor(private readonly outreach: OutreachService) {}

  @Get("summary")
  summary(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(outreachSummaryQuerySchema)) query: OutreachSummaryQuery,
  ) {
    return this.outreach.summary(request.auth.organizationId, new Date(query.dayStart));
  }
}
