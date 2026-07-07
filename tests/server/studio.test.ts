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

  it("stores notification email on first login without overwriting later", async () => {
    const db = await createTestDb();
    const s1 = await ensureStudio(db, "auth0|mail1", "Isaac", "isaac@example.com");
    expect(s1.notificationEmail).toBe("isaac@example.com");
    const s2 = await ensureStudio(db, "auth0|mail1", "Isaac", "otro@example.com");
    expect(s2.notificationEmail).toBe("isaac@example.com");
    const s3 = await ensureStudio(db, "auth0|mail2", "Sin Mail");
    expect(s3.notificationEmail).toBeNull();
  });
});
