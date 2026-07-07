import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.R2_ACCOUNT_ID = "testaccount";
  process.env.R2_ACCESS_KEY_ID = "testkey";
  process.env.R2_SECRET_ACCESS_KEY = "testsecret";
  process.env.R2_BUCKET = "test-bucket";
});

describe("storage presigning (offline)", () => {
  it("creates a signed PUT URL scoped to bucket, key and content type", async () => {
    const { presignUpload } = await import("@/server/storage");
    const url = await presignUpload("studios/a/galleries/b/c/orig-x.jpg", "image/jpeg");
    expect(url).toContain("testaccount.r2.cloudflarestorage.com/test-bucket/studios/a/galleries/b/c/orig-x.jpg");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=600");
  });

  it("creates a signed GET URL with 900s expiry", async () => {
    const { presignDownload } = await import("@/server/storage");
    const url = await presignDownload("k/thumb.jpg");
    expect(url).toContain("/test-bucket/k/thumb.jpg");
    expect(url).toContain("X-Amz-Expires=900");
  });

  it("clamps caller-supplied expiry to the security ceiling", async () => {
    const { presignUpload, presignDownload } = await import("@/server/storage");
    expect(await presignUpload("k/a.jpg", "image/jpeg", 99999)).toContain("X-Amz-Expires=600");
    expect(await presignDownload("k/a.jpg", 99999)).toContain("X-Amz-Expires=900");
  });

  it("signs content-length when provided, enforcing the declared upload size", async () => {
    const { presignUpload } = await import("@/server/storage");
    const url = await presignUpload("k/a.jpg", "image/jpeg", 600, 12345);
    const signedHeaders = decodeURIComponent(new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "");
    expect(signedHeaders).toContain("content-length");
  });
});
