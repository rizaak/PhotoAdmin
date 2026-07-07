import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.CLIENT_SESSION_SECRET = "a".repeat(64);
});

describe("client session JWT", () => {
  it("signs and verifies a round-trip payload", async () => {
    const { signClientSession, verifyClientSession } = await import("@/server/client-session");
    const token = await signClientSession({ clientId: "c1", galleryId: "g1" });
    expect(await verifyClientSession(token)).toEqual({ clientId: "c1", galleryId: "g1" });
  });

  it("rejects tampered tokens and garbage", async () => {
    const { signClientSession, verifyClientSession } = await import("@/server/client-session");
    const token = await signClientSession({ clientId: "c1", galleryId: "g1" });
    expect(await verifyClientSession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await verifyClientSession("garbage")).toBeNull();
  });

  it("builds gallery-scoped cookie options", async () => {
    const { clientCookieOptions, CLIENT_COOKIE } = await import("@/server/client-session");
    expect(CLIENT_COOKIE).toBe("client_session");
    const opts = clientCookieOptions("boda-ana-x1");
    expect(opts.path).toBe("/g/boda-ana-x1");
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
  });
});
