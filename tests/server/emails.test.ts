import { describe, it, expect, beforeEach } from "vitest";
import { notifyPhotographer, firstAccessEmail, commentEmail } from "@/server/emails";

describe("emails", () => {
  beforeEach(() => { delete process.env.RESEND_API_KEY; });

  it("builds first-access and comment payloads", () => {
    const a = firstAccessEmail("Boda Ana", "ana@x.com");
    expect(a.subject).toContain("Boda Ana");
    expect(a.text).toContain("ana@x.com");
    const c = commentEmail("Boda Ana", "ana@x.com", "Preciosa!", "IMG_1.jpg");
    expect(c.text).toContain("Preciosa!");
    expect(c.text).toContain("IMG_1.jpg");
  });

  it("is a silent no-op without API key or recipient", async () => {
    await expect(notifyPhotographer({ to: "x@y.com", subject: "s", text: "t" })).resolves.toBeUndefined();
    process.env.RESEND_API_KEY = "re_fake";
    await expect(notifyPhotographer({ to: null, subject: "s", text: "t" })).resolves.toBeUndefined();
  });
});
