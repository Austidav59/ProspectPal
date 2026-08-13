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

  it("treats blank optional Gmail vars as unset", () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        GOOGLE_GMAIL_CLIENT_ID: "",
        GOOGLE_GMAIL_CLIENT_SECRET: "",
        GOOGLE_GMAIL_REDIRECT_URI: "",
      }),
    ).toMatchObject({
      GOOGLE_GMAIL_CLIENT_ID: undefined,
      GOOGLE_GMAIL_CLIENT_SECRET: undefined,
      GOOGLE_GMAIL_REDIRECT_URI: undefined,
    });
  });

  it("rejects partial Gmail OAuth config", () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        GOOGLE_GMAIL_CLIENT_ID: "only-one",
      }),
    ).toThrow(/GMAIL/);
  });
});
