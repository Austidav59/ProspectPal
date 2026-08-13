import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccessTokenGuard } from "../src/auth/access-token.guard";
import { CampaignsController } from "../src/campaigns/campaigns.controller";
import { CampaignsService } from "../src/campaigns/campaigns.service";

describe("Campaign API", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [CampaignsController],
      providers: [
        {
          provide: CampaignsService,
          useValue: {
            list: vi.fn(),
            create: vi.fn(),
            get: vi.fn(),
            update: vi.fn(),
            archive: vi.fn(),
            run: vi.fn(),
            pause: vi.fn(),
          },
        },
      ],
    });
    const module = await moduleBuilder
      .overrideGuard(AccessTokenGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): {
            getRequest(): { auth: { organizationId: string; sub: string } };
          };
        }) => {
          context.switchToHttp().getRequest().auth = {
            organizationId: crypto.randomUUID(),
            sub: crypto.randomUUID(),
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

  it("validates campaign creation requests", async () => {
    const server = app.getHttpServer() as unknown as Parameters<typeof request>[0];
    const response = await request(server).post("/api/campaigns").send({
      name: "Invalid campaign",
      country: "US",
      city: "Wichita",
      niche: "plumber",
      maximumResults: 500,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ message: "Validation failed" });
  });
});
