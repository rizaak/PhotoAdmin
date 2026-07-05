import { describe, it, expect } from "vitest";
import { createTestDb } from "../helpers/db";
import { ensureStudio } from "@/server/studio";

describe("ensureStudio", () => {
  it("creates a studio on first login and returns the same one afterwards", async () => {
    const db = await createTestDb();
    const first = await ensureStudio(db, "auth0|abc123", "Isaac López");
    expect(first.name).toBe("Isaac López");
    expect(first.auth0UserId).toBe("auth0|abc123");

    const second = await ensureStudio(db, "auth0|abc123", "Otro Nombre");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Isaac López"); // no sobreescribe
  });
});
