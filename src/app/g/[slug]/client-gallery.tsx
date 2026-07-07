"use client";

import { useState } from "react";
import { toggleLikeAction, addCommentAction } from "./actions";

export type ClientPhoto = {
  id: string;
  filename: string;
  sectionId: string | null;
  thumbUrl: string;
  webUrl: string;
  liked: boolean;
  comments: { id: string; body: string }[];
};

type Labels = {
  like: string; unlike: string; comments: string; commentPlaceholder: string;
  send: string; empty: string; yourActivity: string; actionError: string;
};

export function ClientGallery({
  slug, title, theme, coverUrl, coverFocalX, coverFocalY,
  sections, photos: initialPhotos, labels,
}: {
  slug: string; title: string; theme: "light" | "dark";
  coverUrl: string | null; coverFocalX: number; coverFocalY: number;
  sections: { id: string | null; name: string | null }[];
  photos: ClientPhoto[]; labels: Labels;
}) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [openPhoto, setOpenPhoto] = useState<ClientPhoto | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const dark = theme === "dark";
  const bg = dark ? "bg-neutral-950 text-neutral-100" : "bg-white text-neutral-900";

  async function onToggleLike(photo: ClientPhoto) {
    try {
      const { liked } = await toggleLikeAction({ slug, photoId: photo.id });
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, liked } : p)));
      setOpenPhoto((prev) => (prev && prev.id === photo.id ? { ...prev, liked } : prev));
    } catch {
      alert(labels.actionError);
    }
  }

  async function onComment(photo: ClientPhoto) {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const c = await addCommentAction({ slug, photoId: photo.id, body: draft });
      const update = (p: ClientPhoto) =>
        p.id === photo.id ? { ...p, comments: [...p.comments, { id: c.id, body: c.body }] } : p;
      setPhotos((prev) => prev.map(update));
      setOpenPhoto((prev) => (prev ? update(prev) : prev));
      setDraft("");
    } catch {
      alert(labels.actionError);
    } finally {
      setBusy(false);
    }
  }

  const bySection = sections
    .map((s) => ({ ...s, photos: photos.filter((p) => p.sectionId === s.id) }))
    .filter((s) => s.photos.length > 0);

  return (
    <main className={`min-h-screen ${bg}`}>
      <header className="relative flex h-[45vh] min-h-64 items-end justify-center overflow-hidden">
        {coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl} alt="" draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: `${coverFocalX * 100}% ${coverFocalY * 100}%` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <h1 className="relative pb-10 font-serif text-4xl text-white drop-shadow">{title}</h1>
      </header>

      <p className="mx-auto max-w-5xl px-4 pt-4 text-xs opacity-60">{labels.yourActivity}</p>

      {photos.length === 0 && <p className="p-10 text-center text-sm opacity-60">{labels.empty}</p>}

      <div className="mx-auto max-w-5xl space-y-10 p-4">
        {bySection.map((s) => (
          <section key={s.id ?? "none"}>
            {s.name && <h2 className="mb-3 font-serif text-2xl">{s.name}</h2>}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {s.photos.map((p) => (
                <figure key={p.id} className="group relative cursor-pointer" onClick={() => setOpenPhoto(p)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt={p.filename} draggable={false}
                    className="aspect-square w-full rounded object-cover" />
                  <button
                    aria-label={p.liked ? labels.unlike : labels.like}
                    onClick={(e) => { e.stopPropagation(); void onToggleLike(p); }}
                    className={`absolute right-2 top-2 rounded-full px-2 py-1 text-sm backdrop-blur ${
                      p.liked ? "bg-red-500 text-white" : "bg-black/40 text-white opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    ♥
                  </button>
                  {p.comments.length > 0 && (
                    <span className="absolute bottom-2 right-2 rounded bg-black/50 px-1.5 text-xs text-white">
                      💬 {p.comments.length}
                    </span>
                  )}
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>

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
            <h3 className="text-sm font-medium">{labels.comments}</h3>
            <ul className="space-y-2 text-sm">
              {openPhoto.comments.map((c) => (
                <li key={c.id} className="rounded bg-neutral-100 p-2">{c.body}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder={labels.commentPlaceholder}
                onKeyDown={(e) => { if (e.key === "Enter") void onComment(openPhoto); }}
                className="flex-1 rounded border px-2 py-1.5 text-sm"
              />
              <button disabled={busy} onClick={() => void onComment(openPhoto)}
                className="rounded bg-neutral-900 px-3 text-sm text-white disabled:opacity-50">
                {labels.send}
              </button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
