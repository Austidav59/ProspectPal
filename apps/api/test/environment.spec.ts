import { describe, expect, it } from "vitest";

import { validateEnvironment } from "../src/config/environment";

const validEnvironment = {
  WEB_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/seo_prospector",
  AUTH0_DOMAIN: "dev-example.us.auth0.com",
  AUTH0_AUDIENCE: "https://api.prospect-pilot.local",
};

describe("validateEnvironment", () => {
  it("applies safe development defaults", () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      API_PORT: 3000,
      NODE_ENV: "development",
      BUSINESS_DISCOVERY_PROVIDER: "mock",
    });
  });

  it("rejects a missing Auth0 audience", () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, AUTH0_AUDIENCE: "" }),
    ).toThrow();
  });

  it("prefers Render PORT over API_PORT", () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        PORT: "10000",
        API_PORT: "3000",
      }),
    ).toMatchObject({ API_PORT: 10000 });
  });
});
