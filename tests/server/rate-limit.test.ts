import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRateLimit, resetRateLimit } from "@/server/rate-limit";

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
