import {
  Controller,
  Delete,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";

import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard";
import type { Environment } from "../config/environment";
import { GmailService } from "./gmail.service";

@Controller("email/gmail")
export class GmailController {
  constructor(
    private readonly gmail: GmailService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  @Get("status")
  @UseGuards(AccessTokenGuard)
  status(@Req() request: AuthenticatedRequest) {
    return this.gmail.getStatus(request.auth.sub);
  }

  @Get("connect")
  @UseGuards(AccessTokenGuard)
  async connect(@Req() request: AuthenticatedRequest) {
    const url = await this.gmail.createConnectUrl(
      request.auth.sub,
      request.auth.organizationId,
    );
    return { url };
  }

  /** Google OAuth redirect — no Auth0 bearer (browser navigation). */
  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() response: Response,
  ) {
    const webOrigin = this.config.getOrThrow<string>("WEB_ORIGIN");
    if (error) {
      response.redirect(
        `${webOrigin}/?gmail=error&reason=${encodeURIComponent(error)}#settings`,
      );
      return;
    }
    if (!code || !state) {
      response.redirect(`${webOrigin}/?gmail=error&reason=missing_code#settings`);
      return;
    }

    try {
      const redirectTo = await this.gmail.handleCallback(code, state);
      response.redirect(redirectTo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "connect_failed";
      response.redirect(
        `${webOrigin}/?gmail=error&reason=${encodeURIComponent(message)}#settings`,
      );
    }
  }

  @Delete("disconnect")
  @UseGuards(AccessTokenGuard)
  disconnect(@Req() request: AuthenticatedRequest) {
    return this.gmail.disconnect(request.auth.sub);
  }
}
