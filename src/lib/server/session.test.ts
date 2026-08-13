import { describe, expect, it } from "vitest";
import { bearerTokenForAuthorization } from "@/lib/auth-token";

describe("bearerTokenForAuthorization", () => {
  it("accepts native bearer tokens", () => {
    expect(bearerTokenForAuthorization("Bearer abcdefghijklmnopqrstuvwxyz_123456789")).toBe("abcdefghijklmnopqrstuvwxyz_123456789");
  });

  it("rejects malformed or suspicious authorization values", () => {
    expect(bearerTokenForAuthorization("Basic abc")).toBeUndefined();
    expect(bearerTokenForAuthorization("Bearer too-short")).toBeUndefined();
    expect(bearerTokenForAuthorization("Bearer abc.def.ghiabcdefghijklmnopqrstuvwxyz")).toBeUndefined();
  });
});
