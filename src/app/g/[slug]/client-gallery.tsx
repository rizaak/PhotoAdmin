"use client";

import { useEffect, useRef, useState } from "react";
import { PALETTE_TOKENS, FONT_TOKENS, type GalleryDesign } from "./design-options";
import { fontVariables } from "./fonts";
import { GalleryCover } from "./gallery-cover";
import { TitleBar } from "./title-bar";
import { PhotoGrid } from "./photo-grid";
import { Lightbox } from "./lightbox";
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
  favorites: string; noFavorites: string;
  downloadGallery: string; downloadFavorites: string; downloadSection: string;
  zipError: string; zipUnavailable: string;
  close: string; prev: string; next: string;
  // Solo se usan en modo preview (fotógrafo revisando su propia galería).
  previewBanner?: string; previewOnly?: string;
};

export function ClientGallery({
  slug, title, design, coverUrl, coverFocalX, coverFocalY,
  sections, photos: initialPhotos, labels, zip, previewMode = false,
}: {
  slug: string; title: string; design: GalleryDesign;
  coverUrl: string | null; coverFocalX: number; coverFocalY: number;
  sections: { id: string; name: string }[];
  photos: ClientPhoto[]; labels: Labels;
  zip: { enabled: boolean; resolutions: Res[] };
  // Vista de solo lectura para el fotógrafo: like/comentario/descarga/zip nunca
  // disparan las server actions reales, sin importar qué UI intente llamarlas.
  previewMode?: boolean;
}) {
  const pt = PALETTE_TOKENS[design.palette];
  const ft = FONT_TOKENS[design.fontSet];
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [photos, setPhotos] = useState(initialPhotos);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [zipResolution, setZipResolution] = useState<Res>(zip.resolutions[0] ?? "web");
  const [activeSectionId, setActiveSectionId] = useState<string | null>(sections[0]?.id ?? null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  async function onToggleLike(photo: ClientPhoto) {
    // ponytail: guard here too, not just on the disabled buttons — no path through
    // this component can reach the server action in preview mode.
    if (previewMode) return;
    try {
      const { liked } = await toggleLikeAction({ slug, photoId: photo.id });
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, liked } : p)));
    } catch {
      setNotice(labels.actionError);
    }
  }

  async function onDownload(photo: ClientPhoto, resolution: Res) {
    if (previewMode) return;
    const { url } = await downloadPhotoAction({ slug, photoId: photo.id, resolution });
    window.location.assign(url);
  }

  async function onZip(scope: { type: "gallery" | "favorites" } | { type: "section"; sectionId: string }) {
    if (previewMode) return;
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
    if (previewMode || !body.trim() || busy) return;
    setBusy(true);
    try {
      const c = await addCommentAction({ slug, photoId: photo.id, body });
      setPhotos((prev) => prev.map((p) =>
        p.id === photo.id ? { ...p, comment: { id: c.id, body: c.body } } : p));
    } finally {
      setBusy(false);
    }
  }

  const visible = photos.filter((p) =>
    p.sectionId === activeSectionId && (!favoritesOnly || p.liked));

  return (
    <main className={`${fontVariables} ${previewMode ? "pt-9" : ""}`} style={{ background: pt.bg, color: pt.text, fontFamily: ft.body }}>
      {previewMode && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[70] bg-neutral-900 px-4 py-2 text-center text-xs text-white"
        >
          {labels.previewBanner}
        </div>
      )}
      <GalleryCover design={design} title={title} coverUrl={coverUrl} focalX={coverFocalX} focalY={coverFocalY} />
      <div ref={sentinelRef} className="absolute top-[60vh]" />
      <TitleBar
        design={design} title={title} sections={sections}
        activeSectionId={activeSectionId} onSelectSection={setActiveSectionId}
        favoritesOnly={favoritesOnly} onToggleFavorites={() => setFavoritesOnly((v) => !v)}
        zip={zip} zipResolution={zipResolution} onZipResolution={setZipResolution}
        onZip={(scope) => void onZip(scope)}
        sentinel={sentinelRef}
        previewMode={previewMode}
        labels={{
          favorites: labels.favorites, downloadGallery: labels.downloadGallery,
          downloadFavorites: labels.downloadFavorites, downloadSection: labels.downloadSection,
          resolutions: labels.resolutions, previewOnly: labels.previewOnly,
        }}
      />

      <p className="mx-auto max-w-6xl px-4 pt-10 text-xs opacity-60">{labels.yourActivity}</p>

      {sections.length === 0 && photos.length === 0 && (
        <p className="p-10 text-center text-sm opacity-60">{labels.empty}</p>
      )}
      {favoritesOnly && visible.length === 0 && (
        <p className="p-16 text-center text-sm" style={{ color: pt.muted }}>{labels.noFavorites}</p>
      )}

      <div className="mx-auto max-w-6xl p-4">
        <PhotoGrid
          design={design} photos={visible} onOpen={(p) => setOpenId(p.id)}
          onToggleLike={(p) => void onToggleLike(p)}
          likeLabel={labels.like} unlikeLabel={labels.unlike}
          previewMode={previewMode} previewOnlyLabel={labels.previewOnly}
        />
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
        photos={visible} openId={openId} busy={busy} labels={labels}
        onClose={() => setOpenId(null)} onNavigate={setOpenId}
        onToggleLike={onToggleLike} onDownload={onDownload} onComment={onComment}
        previewMode={previewMode}
      />
    </main>
  );
}
