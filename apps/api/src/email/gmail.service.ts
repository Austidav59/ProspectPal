import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SignJWT, jwtVerify } from "jose";

import type { Environment } from "../config/environment";
import { PrismaService } from "../database/prisma.service";

const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

interface OAuthState {
  userId: string;
  organizationId: string;
}

export interface GmailConnectionStatus {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  configured: boolean;
}

@Injectable()
export class GmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get("GOOGLE_GMAIL_CLIENT_ID", { infer: true }) &&
        this.config.get("GOOGLE_GMAIL_CLIENT_SECRET", { infer: true }) &&
        this.config.get("GOOGLE_GMAIL_REDIRECT_URI", { infer: true }),
    );
  }

  async getStatus(userId: string): Promise<GmailConnectionStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        gmailEmail: true,
        gmailRefreshToken: true,
        gmailConnectedAt: true,
      },
    });
    const connected = Boolean(user?.gmailRefreshToken && user.gmailEmail);
    return {
      connected,
      email: connected ? (user?.gmailEmail ?? null) : null,
      connectedAt: user?.gmailConnectedAt?.toISOString() ?? null,
      configured: this.isConfigured(),
    };
  }

  async createConnectUrl(userId: string, organizationId: string): Promise<string> {
    const { clientId, redirectUri } = this.requireOAuthConfig();
    const state = await this.signState({ userId, organizationId });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GMAIL_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state,
      include_granted_scopes: "true",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleCallback(code: string, stateToken: string): Promise<string> {
    const { clientId, clientSecret, redirectUri } = this.requireOAuthConfig();
    const state = await this.verifyState(stateToken);

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!tokenResponse.ok) {
      throw new BadRequestException("Google did not accept the Gmail authorization code");
    }

    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!tokens.access_token) {
      throw new BadRequestException("Google did not return an access token");
    }

    const email = await this.fetchGoogleEmail(tokens.access_token);
    const existing = await this.prisma.user.findUnique({
      where: { id: state.userId },
      select: { gmailRefreshToken: true },
    });

    const refreshToken = tokens.refresh_token ?? existing?.gmailRefreshToken;
    if (!refreshToken) {
      throw new BadRequestException(
        "Google did not return a refresh token. Disconnect the app in your Google Account and try again.",
      );
    }

    const expiresAt =
      typeof tokens.expires_in === "number"
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;

    await this.prisma.user.update({
      where: { id: state.userId },
      data: {
        gmailEmail: email,
        gmailRefreshToken: refreshToken,
        gmailAccessToken: tokens.access_token,
        gmailTokenExpiresAt: expiresAt,
        gmailConnectedAt: new Date(),
      },
    });

    const webOrigin = this.config.getOrThrow<string>("WEB_ORIGIN");
    return `${webOrigin}/?gmail=connected#settings`;
  }

  async disconnect(userId: string): Promise<GmailConnectionStatus> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        gmailEmail: null,
        gmailRefreshToken: null,
        gmailAccessToken: null,
        gmailTokenExpiresAt: null,
        gmailConnectedAt: null,
      },
    });
    return this.getStatus(userId);
  }

  async sendMail(input: {
    userId: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        gmailEmail: true,
        gmailRefreshToken: true,
        gmailAccessToken: true,
        gmailTokenExpiresAt: true,
      },
    });

    if (!user?.gmailRefreshToken || !user.gmailEmail) {
      throw new BadRequestException(
        "Connect your Gmail inbox in Settings before sending emails",
      );
    }

    const accessToken = await this.getValidAccessToken(user);
    const raw = this.buildRawMessage({
      from: user.gmailEmail,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });

    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(20_000),
      },
    );

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof (payload as { error?: { message?: string } }).error?.message === "string"
          ? (payload as { error: { message: string } }).error.message
          : `Gmail rejected the send (status ${response.status})`;
      throw new BadRequestException(message);
    }
  }

  private requireOAuthConfig(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } {
    const clientId = this.config.get("GOOGLE_GMAIL_CLIENT_ID", { infer: true });
    const clientSecret = this.config.get("GOOGLE_GMAIL_CLIENT_SECRET", { infer: true });
    const redirectUri = this.config.get("GOOGLE_GMAIL_REDIRECT_URI", { infer: true });
    if (!clientId || !clientSecret || !redirectUri) {
      throw new ServiceUnavailableException(
        "Gmail connect is not configured. Set GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, and GOOGLE_GMAIL_REDIRECT_URI.",
      );
    }
    return { clientId, clientSecret, redirectUri };
  }

  private stateSecret(): Uint8Array {
    const clientSecret = this.config.get("GOOGLE_GMAIL_CLIENT_SECRET", { infer: true });
    if (!clientSecret) {
      throw new ServiceUnavailableException("Gmail connect is not configured");
    }
    return new TextEncoder().encode(`gmail-oauth-state:${clientSecret}`);
  }

  private async signState(state: OAuthState): Promise<string> {
    return new SignJWT({ ...state })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(this.stateSecret());
  }

  private async verifyState(token: string): Promise<OAuthState> {
    try {
      const { payload } = await jwtVerify(token, this.stateSecret());
      const userId = typeof payload.userId === "string" ? payload.userId : null;
      const organizationId =
        typeof payload.organizationId === "string" ? payload.organizationId : null;
      if (!userId || !organizationId) {
        throw new Error("missing claims");
      }
      return { userId, organizationId };
    } catch {
      throw new BadRequestException("Gmail connect link expired — try Connect Gmail again");
    }
  }

  private async fetchGoogleEmail(accessToken: string): Promise<string> {
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new BadRequestException("Unable to read your Gmail address from Google");
    }
    const body = (await response.json()) as { email?: string };
    if (!body.email) {
      throw new BadRequestException("Google account did not return an email address");
    }
    return body.email.toLowerCase();
  }

  private async getValidAccessToken(user: {
    gmailEmail: string | null;
    gmailRefreshToken: string | null;
    gmailAccessToken: string | null;
    gmailTokenExpiresAt: Date | null;
  }): Promise<string> {
    const skewMs = 60_000;
    if (
      user.gmailAccessToken &&
      user.gmailTokenExpiresAt &&
      user.gmailTokenExpiresAt.getTime() > Date.now() + skewMs
    ) {
      return user.gmailAccessToken;
    }

    const { clientId, clientSecret } = this.requireOAuthConfig();
    if (!user.gmailRefreshToken) {
      throw new BadRequestException("Connect your Gmail inbox in Settings before sending emails");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: user.gmailRefreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new BadRequestException(
        "Gmail access expired. Disconnect and reconnect your inbox in Settings.",
      );
    }

    const tokens = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token) {
      throw new BadRequestException("Unable to refresh Gmail access");
    }

    const expiresAt =
      typeof tokens.expires_in === "number"
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null;

    await this.prisma.user.updateMany({
      where: { gmailRefreshToken: user.gmailRefreshToken },
      data: {
        gmailAccessToken: tokens.access_token,
        gmailTokenExpiresAt: expiresAt,
      },
    });

    return tokens.access_token;
  }

  private buildRawMessage(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): string {
    const encodedSubject = `=?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`;
    const message = [
      `From: ${input.from}`,
      `To: ${input.to}`,
      `Subject: ${encodedSubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      input.text,
    ].join("\r\n");

    return Buffer.from(message, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
}
