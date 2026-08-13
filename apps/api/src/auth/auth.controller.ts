import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";

import { AccessTokenGuard, type AuthenticatedRequest } from "./access-token.guard";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get("me")
  @UseGuards(AccessTokenGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.getCurrentUser(request.auth);
  }
}
