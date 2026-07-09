import { describe, it, expect } from "vitest";
import { pickCoverSource } from "@/server/cover";

const photo = (over = {}) => ({ id: "p1", sectionId: "s1", published: true, status: "ready", ...over });

describe("pickCoverSource", () => {
  it("prefers the uploaded cover image", () => {
    expect(pickCoverSource(
      { coverImageKey: "studios/s/covers/g/a.jpg", coverPhotoId: "p1" },
      [photo()],
    )).toEqual({ type: "upload", key: "studios/s/covers/g/a.jpg" });
  });
  it("falls back to the cover photo, then to the first eligible photo", () => {
    expect(pickCoverSource({ coverImageKey: null, coverPhotoId: "p2" },
      [photo(), photo({ id: "p2" })])).toMatchObject({ type: "photo", photo: { id: "p2" } });
    expect(pickCoverSource({ coverImageKey: null, coverPhotoId: null },
      [photo({ published: false }), photo({ id: "p3" })])).toMatchObject({ type: "photo", photo: { id: "p3" } });
    expect(pickCoverSource({ coverImageKey: null, coverPhotoId: null }, [photo({ status: "processing" })])).toBeNull();
  });
});
