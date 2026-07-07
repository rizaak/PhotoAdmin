import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, isRateLimited, resetRateLimit } from "@/server/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimit();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("allows up to max attempts then blocks", () => {
    for (let i = 0; i < 10; i++)
      expect(checkRateLimit("ip1:slug", 10, 900000)).toBe(true);
    expect(checkRateLimit("ip1:slug", 10, 900000)).toBe(false);
    expect(checkRateLimit("ip2:slug", 10, 900000)).toBe(true); // otra clave no afectada
  });

  it("frees attempts after the window slides", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("k", 10, 900000);
    expect(checkRateLimit("k", 10, 900000)).toBe(false);
    vi.advanceTimersByTime(900001);
    expect(checkRateLimit("k", 10, 900000)).toBe(true);
  });
});

describe("isRateLimited", () => {
  beforeEach(() => {
    resetRateLimit();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("peeking doesn't consume attempts", () => {
    for (let i = 0; i < 20; i++)
      expect(isRateLimited("peek", 10, 900000)).toBe(false);
  });

  it("reflects consumed attempts from checkRateLimit without consuming itself", () => {
    for (let i = 0; i < 10; i++) checkRateLimit("peek2", 10, 900000);
    expect(isRateLimited("peek2", 10, 900000)).toBe(true);
    // still blocked after repeated peeks, not un-blocked and not further consumed
    expect(isRateLimited("peek2", 10, 900000)).toBe(true);
  });
});
