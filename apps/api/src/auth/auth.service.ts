import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserRole, type Prisma } from "../generated/prisma";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type { Environment } from "../config/environment";
import { PrismaService } from "../database/prisma.service";

export interface AccessClaims {
  sub: string;
  organizationId: string;
  role: UserRole;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  role: UserRole;
}

type UserWithMemberships = Prisma.UserGetPayload<{
  include: { memberships: { take: 1 } };
}>;

interface Auth0Profile {
  sub: string;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly domain: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) config: ConfigService<Environment, true>,
  ) {
    this.domain = config.getOrThrow<string>("AUTH0_DOMAIN");
    this.audience = config.getOrThrow<string>("AUTH0_AUDIENCE");
    this.issuer = `https://${this.domain}/`;
    this.jwks = createRemoteJWKSet(new URL(`https://${this.domain}/.well-known/jwks.json`));
  }

  async verifyAccessToken(token: string): Promise<AccessClaims> {
    const payload = await this.verifyJwt(token);
    const auth0Sub = payload.sub;
    if (!auth0Sub) {
      throw new UnauthorizedException("Access token is missing subject");
    }

    // Returning users: resolve from our DB by Auth0 sub. Do NOT call Auth0
    // /userinfo on every request — that endpoint rate-limits and times out,
    // which is what caused the intermittent "Unable to load Auth0 user profile".
    const existing = await this.prisma.user.findUnique({
      where: { auth0Sub },
      include: { memberships: { take: 1 } },
    });
    if (existing) {
      return this.toAccessClaims(this.toAuthenticatedUser(existing));
    }

    const profile = await this.resolveProfile(token, payload, auth0Sub);
    const user = await this.syncUser(profile);
    return this.toAccessClaims(user);
  }

  async getCurrentUser(claims: AccessClaims): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      include: { memberships: { take: 1 } },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("User is not active");
    }

    return this.toAuthenticatedUser(user);
  }

  private async verifyJwt(token: string): Promise<JWTPayload> {
    try {
      const verified = await jwtVerify(token, this.jwks, {
        audience: this.audience,
        issuer: this.issuer,
      });
      return verified.payload;
    } catch {
      throw new UnauthorizedException("Access token is invalid");
    }
  }

  private async resolveProfile(
    token: string,
    payload: JWTPayload,
    sub: string,
  ): Promise<Auth0Profile> {
    const emailFromToken = this.readEmailClaim(payload);
    const nameFromToken =
      this.readStringClaim(payload, "name") ?? this.readStringClaim(payload, "nickname");

    if (emailFromToken) {
      return {
        sub,
        email: emailFromToken,
        name: nameFromToken ?? emailFromToken.split("@")[0] ?? "User",
      };
    }

    return this.fetchUserInfo(token, sub);
  }

  private async fetchUserInfo(token: string, sub: string): Promise<Auth0Profile> {
    let lastError = "Unable to load Auth0 user profile";

    // Brief retries — Auth0 /userinfo is flaky under parallel first-login traffic.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }

      try {
        const response = await fetch(`https://${this.domain}/userinfo`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5_000),
        });

        if (!response.ok) {
          lastError =
            response.status === 429
              ? "Auth0 rate-limited the profile request — try again in a moment"
              : `Unable to load Auth0 user profile (${response.status})`;
          continue;
        }

        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null) {
          lastError = "Auth0 user profile is invalid";
          continue;
        }

        const record = body as Record<string, unknown>;
        const email = typeof record.email === "string" ? record.email.toLowerCase() : undefined;
        if (!email) {
          throw new UnauthorizedException("Auth0 profile is missing an email address");
        }

        const name =
          (typeof record.name === "string" && record.name.trim().length > 0
            ? record.name
            : undefined) ??
          (typeof record.nickname === "string" && record.nickname.trim().length > 0
            ? record.nickname
            : undefined) ??
          email.split("@")[0] ??
          "User";

        return { sub, email, name };
      } catch (error: unknown) {
        if (error instanceof UnauthorizedException) throw error;
        lastError =
          error instanceof Error && error.name === "TimeoutError"
            ? "Auth0 profile request timed out"
            : "Unable to load Auth0 user profile";
      }
    }

    throw new UnauthorizedException(lastError);
  }

  private async syncUser(profile: Auth0Profile): Promise<AuthenticatedUser> {
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: profile.email },
      include: { memberships: { take: 1 } },
    });

    if (existingByEmail) {
      const linked = await this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          auth0Sub: profile.sub,
          name: profile.name,
        },
        include: { memberships: { take: 1 } },
      });
      return this.toAuthenticatedUser(linked);
    }

    try {
      const created = await this.prisma.user.create({
        data: {
          auth0Sub: profile.sub,
          email: profile.email,
          name: profile.name,
          memberships: {
            create: {
              role: UserRole.ADMIN,
              organization: {
                create: {
                  name: `${profile.name}'s Agency`,
                },
              },
            },
          },
        },
        include: { memberships: { take: 1 } },
      });
      return this.toAuthenticatedUser(created);
    } catch {
      // Parallel first-login requests can race on create — reload by sub.
      const raced = await this.prisma.user.findUnique({
        where: { auth0Sub: profile.sub },
        include: { memberships: { take: 1 } },
      });
      if (raced) return this.toAuthenticatedUser(raced);
      throw new UnauthorizedException("Unable to create workspace for this Auth0 user");
    }
  }

  private toAccessClaims(user: AuthenticatedUser): AccessClaims {
    return {
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role,
    };
  }

  private toAuthenticatedUser(user: UserWithMemberships): AuthenticatedUser {
    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException("User is not active");
    }

    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException("User has no organization membership");
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      organizationId: membership.organizationId,
      role: membership.role,
    };
  }

  private readEmailClaim(payload: JWTPayload): string | undefined {
    const direct = this.readStringClaim(payload, "email");
    if (direct) return direct.toLowerCase();

    // Custom Auth0 Action claims often use the API audience as a namespace.
    for (const [key, value] of Object.entries(payload)) {
      if (
        (key.endsWith("/email") || key.endsWith("/email_address")) &&
        typeof value === "string" &&
        value.includes("@")
      ) {
        return value.toLowerCase();
      }
    }
    return undefined;
  }

  private readStringClaim(payload: JWTPayload, key: string): string | undefined {
    const value = payload[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }
}
