import { describe, expect, it } from "vitest";

import { userSchema } from "./api";

describe("userSchema", () => {
  it("rejects an unverified API user payload", () => {
    const result = userSchema.safeParse({
      id: "not-a-uuid",
      email: "bad",
      name: "",
      organizationId: "also-bad",
      role: "OWNER",
    });

    expect(result.success).toBe(false);
  });
});
