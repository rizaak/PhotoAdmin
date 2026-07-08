"use client";

import { useEffect, useRef, useState } from "react";
import type { GalleryTemplate } from "@/db/schema";
import { TEMPLATE_TOKENS } from "./templates";
import { fontVariables } from "./fonts";
import { GalleryCover } from "./gallery-cover";
import { GalleryHeader } from "./gallery-header";
import { PhotoGrid } from "./photo-grid";
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
  slug, title, template, coverUrl, coverFocalX, coverFocalY,
  sections, photos: initialPhotos, labels, zip,
}: {
  slug: string; title: string; template: GalleryTemplate;
  coverUrl: string | null; coverFocalX: number; coverFocalY: number;
  sections: { id: string | null; name: string | null }[];
  photos: ClientPhoto[]; labels: Labels;
  zip: { enabled: boolean; resolutions: Res[] };
}) {
  const tk = TEMPLATE_TOKENS[template];
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [photos, setPhotos] = useState(initialPhotos);
  const [openPhoto, setOpenPhoto] = useState<ClientPhoto | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState<Res>("web");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  async function onToggleLike(photo: ClientPhoto) {
    try {
      const { liked } = await toggleLikeAction({ slug, photoId: photo.id });
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, liked } : p)));
      setOpenPhoto((prev) => (prev && prev.id === photo.id ? { ...prev, liked } : prev));
    } catch {
      setNotice(labels.actionError);
    }
  }

  function openLightbox(photo: ClientPhoto) {
    setOpenPhoto(photo);
    setDraft(photo.comment?.body ?? "");
    setResolution(photo.downloads[0] ?? "web");
  }

  async function onDownload(photo: ClientPhoto) {
    try {
      const { url } = await downloadPhotoAction({ slug, photoId: photo.id, resolution });
      window.location.assign(url);
    } catch {
      setNotice(labels.actionError);
    }
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

  async function onComment(photo: ClientPhoto) {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const c = await addCommentAction({ slug, photoId: photo.id, body: draft });
      const update = (p: ClientPhoto) =>
        p.id === photo.id ? { ...p, comment: { id: c.id, body: c.body } } : p;
      setPhotos((prev) => prev.map(update));
      setOpenPhoto((prev) => (prev ? update(prev) : prev));
      setDraft(c.body);
    } catch {
      setNotice(labels.actionError);
    } finally {
      setBusy(false);
    }
  }

  const bySection = sections
    .map((s) => ({ ...s, photos: photos.filter((p) => p.sectionId === s.id) }))
    .filter((s) => s.photos.length > 0);

  return (
    <main className={fontVariables} style={{ background: tk.bg, color: tk.text, fontFamily: tk.body }}>
      <GalleryCover template={template} title={title} coverUrl={coverUrl} focalX={coverFocalX} focalY={coverFocalY} />
      <div ref={sentinelRef} className="absolute top-[60vh]" />
      <GalleryHeader
        template={template} title={title} sentinel={sentinelRef} zip={zip}
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
                style={{ fontFamily: tk.display, fontWeight: tk.displayWeight, fontStyle: tk.displayStyle,
                  textTransform: tk.displayTransform, letterSpacing: tk.displayTracking }}
              >
                {s.name}
                {zip.enabled && zip.resolutions.length > 0 && s.id && (
                  <button
                    title={labels.downloadSection}
                    aria-label={labels.downloadSection}
                    onClick={() => void onZip({ type: "section", sectionId: s.id! }, zip.resolutions[0] ?? "web")}
                    className="opacity-60 hover:opacity-100"
                  >
                    <IconDownload className="h-4 w-4" />
                  </button>
                )}
              </h2>
            )}
            <PhotoGrid
              template={template} photos={s.photos} onOpen={openLightbox}
              onToggleLike={(p) => void onToggleLike(p)}
              likeLabel={labels.like} unlikeLabel={labels.unlike}
            />
          </section>
        ))}
      </div>

      {notice && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-xs shadow-lg"
          style={{ background: tk.surface, color: tk.text }}
        >
          {notice}
        </div>
      )}

      {openPhoto && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 md:flex-row" onClick={() => setOpenPhoto(null)}>
          <div className="flex flex-1 items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={openPhoto.webUrl} alt={openPhoto.filename}
              className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
          <aside
            className="w-full space-y-3 bg-white p-4 text-neutral-900 md:h-full md:w-80 md:overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => void onToggleLike(openPhoto)}
              className={`rounded px-3 py-1.5 text-sm ${openPhoto.liked ? "bg-red-500 text-white" : "border"}`}
            >
              ♥ {openPhoto.liked ? labels.unlike : labels.like}
            </button>
            {openPhoto.downloads.length > 0 && (
              <div className="flex items-center gap-2">
                <select value={resolution} onChange={(e) => setResolution(e.target.value as Res)}
                  className="rounded border px-2 py-1.5 text-sm">
                  {openPhoto.downloads.map((r) => (
                    <option key={r} value={r}>{labels.resolutions[r]}</option>
                  ))}
                </select>
                <button
                  disabled={busy}
                  onClick={() => void onDownload(openPhoto)}
                  className="rounded border px-3 py-1.5 text-sm"
                >
                  ⬇ {labels.download}
                </button>
              </div>
            )}
            <h3 className="text-sm font-medium">{labels.comments}</h3>
            <div className="space-y-2">
              <textarea
                value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder={labels.commentPlaceholder}
                rows={3}
                className="w-full resize-none rounded border px-2 py-1.5 text-sm"
              />
              <button disabled={busy} onClick={() => void onComment(openPhoto)}
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                {labels.send}
              </button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
