import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";

import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { updateSettingsSchema, type UpdateSettingsInput } from "./settings.schemas";
import { SettingsService } from "./settings.service";

@Controller("settings")
@UseGuards(AccessTokenGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.settings.getOrCreate(request.auth.organizationId);
  }

  @Put()
  update(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updateSettingsSchema)) input: UpdateSettingsInput,
  ) {
    return this.settings.update(request.auth.organizationId, input);
  }
}
