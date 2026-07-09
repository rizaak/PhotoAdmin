import { type CoverStyle, type FontSet, type Palette, type GridStyle } from "@/db/schema";
import type { GalleryDesign } from "./design-options";
import type { ClientGalleryData } from "@/server/client-access";
import { presignDownload } from "@/server/storage";
import { pickCoverSource } from "@/server/cover";
import {
  clientViewPhotos, effectiveWatermarkMode, effectiveDownloadEnabled, enabledResolutions, downloadKey,
} from "@/server/delivery";
import type { ClientPhoto } from "./client-gallery";

export function toDesign(g: { coverStyle: string; fontSet: string; palette: string; gridStyle: string }): GalleryDesign {
  return {
    coverStyle: g.coverStyle as CoverStyle, fontSet: g.fontSet as FontSet,
    palette: g.palette as Palette, gridStyle: g.gridStyle as GridStyle,
  };
}

// Construye las props de ClientGallery (portada, secciones, fotos con URLs firmadas y
// permisos de descarga, zip) a partir de los datos ya filtrados por los gates de
// visibilidad. Compartido por la galería autenticada y el modo preview del fotógrafo.
export async function buildGalleryProps(data: ClientGalleryData) {
  const hasWatermarks = !!data.gallery.watermarkId;
  const watermarkGallery = { watermarkMode: data.gallery.watermarkMode, hasWatermarks };
  const viewList = clientViewPhotos(data.photos, data.sections, watermarkGallery);
  const byId = new Map(data.photos.map((p) => [p.id, p]));
  const sectionById = new Map(data.sections.map((s) => [s.id, s]));
  const resolutions = enabledResolutions(data.gallery);
  const photoViews: ClientPhoto[] = await Promise.all(
    viewList.map(async (v) => {
      const p = byId.get(v.id)!;
      const section = p.sectionId ? sectionById.get(p.sectionId) ?? null : null;
      const mode = effectiveWatermarkMode(p, section, watermarkGallery);
      const downloads = effectiveDownloadEnabled(section, data.gallery)
        ? resolutions.filter((r) => downloadKey(p, mode, r) !== null)
        : [];
      return {
        id: p.id,
        filename: p.filename,
        sectionId: v.sectionId,
        thumbUrl: await presignDownload(v.thumbKey),
        webUrl: await presignDownload(v.webKey),
        width: p.width,
        height: p.height,
        liked: data.likedPhotoIds.includes(p.id),
        comment: data.commentsByPhoto[p.id]?.[0]
          ? { id: data.commentsByPhoto[p.id][0].id, body: data.commentsByPhoto[p.id][0].body }
          : null,
        downloads,
      };
    }),
  );
  // Misma prioridad que en la puerta: subida > foto elegida > primera elegible, usando
  // la MISMA lista filtrada/ordenada (data.photos) que ya alimenta la grilla.
  const coverSource = pickCoverSource(data.gallery, data.photos);
  let coverUrl: string | null = null;
  if (coverSource?.type === "upload") {
    coverUrl = await presignDownload(coverSource.key);
  } else if (coverSource?.type === "photo") {
    const coverView = viewList.find((v) => v.id === coverSource.photo.id) ?? viewList[0];
    if (coverView) coverUrl = await presignDownload(coverView.webKey);
  }
  const sectionBlocks = data.sections.map((s) => ({ id: s.id, name: s.name }));
  const zip = {
    enabled: photoViews.some((p) => p.downloads.length > 0),
    resolutions,
  };

  return {
    title: data.gallery.title,
    design: toDesign(data.gallery),
    coverUrl,
    coverFocalX: data.gallery.coverFocalX,
    coverFocalY: data.gallery.coverFocalY,
    sections: sectionBlocks,
    photos: photoViews,
    zip,
  };
}
