export type WatermarkMode = "none" | "view" | "download" | "both";
export type Resolution = "web" | "high" | "original";

export function effectiveWatermarkMode(
  photo: { watermarkOverride: boolean | null },
  section: { watermarkMode: WatermarkMode | null } | null,
  gallery: { watermarkMode: WatermarkMode; hasWatermarks: boolean },
): WatermarkMode {
  if (!gallery.hasWatermarks) return "none";
  if (photo.watermarkOverride === false) return "none";
  if (photo.watermarkOverride === true) return "both";
  return section?.watermarkMode ?? gallery.watermarkMode;
}

export function effectiveDownloadEnabled(
  section: { downloadEnabled: boolean | null } | null,
  gallery: { downloadEnabled: boolean },
): boolean {
  return section?.downloadEnabled ?? gallery.downloadEnabled;
}

export function enabledResolutions(
  gallery: { resWebEnabled: boolean; resHighEnabled: boolean; resOriginalEnabled: boolean },
): Resolution[] {
  const out: Resolution[] = [];
  if (gallery.resWebEnabled) out.push("web");
  if (gallery.resHighEnabled) out.push("high");
  if (gallery.resOriginalEnabled) out.push("original");
  return out;
}

export type PhotoKeys = {
  originalKey: string;
  thumbKey: string | null;
  webKey: string | null;
  highKey: string | null;
  thumbWmKey: string | null;
  webWmKey: string | null;
  highWmKey: string | null;
};

const wmOnView = (m: WatermarkMode) => m === "view" || m === "both";
const wmOnDownload = (m: WatermarkMode) => m === "download" || m === "both";

export function viewKeys(
  photo: PhotoKeys, mode: WatermarkMode,
): { thumbKey: string; webKey: string } | null {
  const thumb = wmOnView(mode) ? photo.thumbWmKey : photo.thumbKey;
  const web = wmOnView(mode) ? photo.webWmKey : photo.webKey;
  if (!thumb || !web) return null;
  return { thumbKey: thumb, webKey: web };
}

export function clientViewPhotos<
  P extends PhotoKeys & { id: string; sectionId: string | null; watermarkOverride: boolean | null },
>(
  photos: P[],
  sections: { id: string; watermarkMode: WatermarkMode | null }[],
  gallery: { watermarkMode: WatermarkMode; hasWatermarks: boolean },
): { id: string; sectionId: string | null; thumbKey: string; webKey: string }[] {
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const out: { id: string; sectionId: string | null; thumbKey: string; webKey: string }[] = [];
  for (const photo of photos) {
    const section = photo.sectionId ? sectionById.get(photo.sectionId) ?? null : null;
    const mode = effectiveWatermarkMode(photo, section, gallery);
    const view = viewKeys(photo, mode);
    if (!view) continue;
    out.push({ id: photo.id, sectionId: photo.sectionId, ...view });
  }
  return out;
}

export function downloadKey(
  photo: PhotoKeys, mode: WatermarkMode, resolution: Resolution,
): string | null {
  if (wmOnDownload(mode)) {
    if (resolution === "web") return photo.webWmKey;
    if (resolution === "high") return photo.highWmKey;
    return null; // el original no se puede marcar
  }
  if (resolution === "web") return photo.webKey;
  if (resolution === "high") return photo.highKey;
  return photo.originalKey;
}
