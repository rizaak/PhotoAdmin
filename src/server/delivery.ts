export type WatermarkMode = "none" | "view" | "download" | "both";
export type Resolution = "web" | "high" | "original";

export function effectiveWatermarkMode(
  photo: { watermarkOverride: boolean | null },
  section: { watermarkMode: WatermarkMode | null } | null,
  gallery: { watermarkMode: WatermarkMode; watermarkText: string | null },
): WatermarkMode {
  if (!gallery.watermarkText) return "none";
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
