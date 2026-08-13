import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccessTokenGuard } from "../src/auth/access-token.guard";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";

describe("Auth API", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            getCurrentUser: vi.fn().mockResolvedValue({
              id: "11111111-1111-1111-1111-111111111111",
              email: "ada@example.com",
              name: "Ada",
              organizationId: "22222222-2222-2222-2222-222222222222",
              role: "ADMIN",
            }),
          },
        },
      ],
    })
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          const request = context.switchToHttp().getRequest();
          request.auth = {
            sub: "11111111-1111-1111-1111-111111111111",
            organizationId: "22222222-2222-2222-2222-222222222222",
            role: "ADMIN",
          };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns the authenticated workspace profile", async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const response = await request(server).get("/api/auth/me");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      email: "ada@example.com",
      role: "ADMIN",
    });
  });
});
