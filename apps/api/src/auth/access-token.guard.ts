import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

import { AuthService, type AccessClaims } from "./auth.service";

export interface AuthenticatedRequest extends Request {
  auth: AccessClaims;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("Bearer token is required");
    }

    request.auth = await this.authService.verifyAccessToken(token);
    return true;
  }
}
