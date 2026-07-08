"use client";

import { useEffect, useRef, useState } from "react";
import { PALETTE_TOKENS, FONT_TOKENS, type GalleryDesign } from "./design-options";
import { fontVariables } from "./fonts";
import { GalleryCover } from "./gallery-cover";
import { GalleryHeader } from "./gallery-header";
import { PhotoGrid } from "./photo-grid";
import { Lightbox } from "./lightbox";
import { IconDownload } from "./icons";
import {
  toggleLikeAction, addCommentAction, downloadPhotoAction, zipRequestAction,
} from "./actions";

type Res = "web" | "high" | "original";

export type ClientPhoto = {
  id: string;
  filename: string;
  sectionId: string | null;
  thumbUrl: string;
  webUrl: string;
  width: number | null;
  height: number | null;
  liked: boolean;
  comment: { id: string; body: string } | null;
  downloads: Res[];
};

type Labels = {
  like: string; unlike: string; comments: string; commentPlaceholder: string;
  send: string; empty: string; yourActivity: string; actionError: string;
  download: string; resolutions: Record<Res, string>;
  downloadGallery: string; downloadFavorites: string; downloadSection: string;
  zipError: string; zipUnavailable: string;
  close: string; prev: string; next: string;
};

export function ClientGallery({
  slug, title, design, coverUrl, coverFocalX, coverFocalY,
  sections, photos: initialPhotos, labels, zip,
}: {
  slug: string; title: string; design: GalleryDesign;
  coverUrl: string | null; coverFocalX: number; coverFocalY: number;
  sections: { id: string | null; name: string | null }[];
  photos: ClientPhoto[]; labels: Labels;
  zip: { enabled: boolean; resolutions: Res[] };
}) {
  const pt = PALETTE_TOKENS[design.palette];
  const ft = FONT_TOKENS[design.fontSet];
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [photos, setPhotos] = useState(initialPhotos);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [zipResolution, setZipResolution] = useState<Res>(zip.resolutions[0] ?? "web");

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  async function onToggleLike(photo: ClientPhoto) {
    try {
      const { liked } = await toggleLikeAction({ slug, photoId: photo.id });
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, liked } : p)));
    } catch {
      setNotice(labels.actionError);
    }
  }

  async function onDownload(photo: ClientPhoto, resolution: Res) {
    const { url } = await downloadPhotoAction({ slug, photoId: photo.id, resolution });
    window.location.assign(url);
  }

  async function onZip(
    scope: { type: "gallery" | "favorites" } | { type: "section"; sectionId: string },
    zipResolution: Res,
  ) {
    try {
      const { url } = await zipRequestAction({ slug, scope, resolution: zipResolution });
      window.location.assign(url);
    } catch (e) {
      const msg = e instanceof Error && e.message.includes("ZIP_NOT_CONFIGURED")
        ? labels.zipUnavailable : labels.zipError;
      setNotice(msg);
    }
  }

  async function onComment(photo: ClientPhoto, body: string) {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      const c = await addCommentAction({ slug, photoId: photo.id, body });
      setPhotos((prev) => prev.map((p) =>
        p.id === photo.id ? { ...p, comment: { id: c.id, body: c.body } } : p));
    } finally {
      setBusy(false);
    }
  }

  const bySection = sections
    .map((s) => ({ ...s, photos: photos.filter((p) => p.sectionId === s.id) }))
    .filter((s) => s.photos.length > 0);
  const flatPhotos = bySection.flatMap((s) => s.photos);

  return (
    <main className={fontVariables} style={{ background: pt.bg, color: pt.text, fontFamily: ft.body }}>
      <GalleryCover design={design} title={title} coverUrl={coverUrl} focalX={coverFocalX} focalY={coverFocalY} />
      <div ref={sentinelRef} className="absolute top-[60vh]" />
      <GalleryHeader
        design={design} title={title} sentinel={sentinelRef} zip={zip}
        resolution={zipResolution} onResolutionChange={setZipResolution}
        onZip={(scope, res) => void onZip(scope, res)}
        labels={{
          downloadGallery: labels.downloadGallery, downloadFavorites: labels.downloadFavorites,
          resolutions: labels.resolutions,
        }}
      />

      <p className="mx-auto max-w-6xl px-4 pt-10 text-xs opacity-60">{labels.yourActivity}</p>

      {photos.length === 0 && <p className="p-10 text-center text-sm opacity-60">{labels.empty}</p>}

      <div className="mx-auto max-w-6xl space-y-10 p-4">
        {bySection.map((s) => (
          <section key={s.id ?? "none"}>
            {s.name && (
              <h2
                className="mb-3 flex items-center gap-2 text-2xl"
                style={{ fontFamily: ft.display, fontWeight: ft.displayWeight, fontStyle: ft.displayStyle,
                  textTransform: ft.displayTransform, letterSpacing: ft.displayTracking }}
              >
                {s.name}
                {zip.enabled && zip.resolutions.length > 0 && s.id && (
                  <button
                    title={labels.downloadSection}
                    aria-label={labels.downloadSection}
                    onClick={() => void onZip({ type: "section", sectionId: s.id! }, zipResolution)}
                    className="opacity-60 hover:opacity-100"
                  >
                    <IconDownload className="h-4 w-4" />
                  </button>
                )}
              </h2>
            )}
            <PhotoGrid
              design={design} photos={s.photos} onOpen={(p) => setOpenId(p.id)}
              onToggleLike={(p) => void onToggleLike(p)}
              likeLabel={labels.like} unlikeLabel={labels.unlike}
            />
          </section>
        ))}
      </div>

      {notice && (
        <div
          className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-xs shadow-lg"
          style={{ background: pt.surface, color: pt.text }}
        >
          {notice}
        </div>
      )}

      <Lightbox
        photos={flatPhotos} openId={openId} busy={busy} labels={labels}
        onClose={() => setOpenId(null)} onNavigate={setOpenId}
        onToggleLike={onToggleLike} onDownload={onDownload} onComment={onComment}
      />
    </main>
  );
}
