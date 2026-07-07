import { describe, it, expect } from "vitest";
import { formatBytes } from "@/lib/format";

describe("formatBytes", () => {
  it("formats human-readable sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(23.4 * 1024 * 1024)).toBe("23.4 MB");
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe("1.3 GB");
  });
});
