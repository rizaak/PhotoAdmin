"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  movePhotosAction, setPublishedAction, deletePhotosAction, setCoverAction,
} from "./actions";

export type PhotoView = {
  id: string;
  filename: string;
  sectionId: string | null;
  published: boolean;
  status: "processing" | "ready" | "error";
  thumbUrl: string | null;
  webUrl: string | null;
};

type Labels = {
  empty: string; noSection: string; selected: string; moveTo: string; move: string;
  publish: string; hide: string; delete: string; deleteConfirm: string;
  setCover: string; hiddenBadge: string; processingBadge: string; errorBadge: string; clear: string;
};

type Rect = { x: number; y: number; w: number; h: number };

export function PhotoManager({
  galleryId, photos, sections, coverPhotoId, labels,
}: {
  galleryId: string;
  photos: PhotoView[];
  sections: { id: string; name: string }[];
  coverPhotoId: string | null;
  labels: Labels;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<PhotoView | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [band, setBand] = useState<Rect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const router = useRouter();

  const groups = useMemo(() => {
    const bySection = new Map<string | null, PhotoView[]>();
    for (const p of photos) {
      const key = p.sectionId ?? null;
      bySection.set(key, [...(bySection.get(key) ?? []), p]);
    }
    const ordered: { id: string | null; name: string; photos: PhotoView[] }[] = [];
    if (bySection.has(null)) ordered.push({ id: null, name: labels.noSection, photos: bySection.get(null)! });
    for (const s of sections) {
      if (bySection.has(s.id)) ordered.push({ id: s.id, name: s.name, photos: bySection.get(s.id)! });
    }
    return ordered;
  }, [photos, sections, labels.noSection]);

  function toggle(id: string, additive: boolean) {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      if (prev.has(id) && additive) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Selección por arrastre (rubber band) sobre el fondo del contenedor
  function onPointerDown(e: React.PointerEvent) {
    if (e.target !== containerRef.current || e.button !== 0) return;
    const bounds = containerRef.current.getBoundingClientRect();
    dragOrigin.current = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    containerRef.current.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragOrigin.current || !containerRef.current) return;
    const bounds = containerRef.current.getBoundingClientRect();
    const cur = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    const rect: Rect = {
      x: Math.min(dragOrigin.current.x, cur.x),
      y: Math.min(dragOrigin.current.y, cur.y),
      w: Math.abs(dragOrigin.current.x - cur.x),
      h: Math.abs(dragOrigin.current.y - cur.y),
    };
    setBand(rect);
    const next = new Set<string>();
    for (const [id, el] of itemRefs.current) {
      const r = el.getBoundingClientRect();
      const item = { x: r.left - bounds.left, y: r.top - bounds.top, w: r.width, h: r.height };
      const overlaps = item.x < rect.x + rect.w && item.x + item.w > rect.x &&
        item.y < rect.y + rect.h && item.y + item.h > rect.y;
      if (overlaps) next.add(id);
    }
    setSelected(next);
  }
  function onPointerUp() {
    dragOrigin.current = null;
    setBand(null);
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    try {
      await action();
      setSelected(new Set());
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const ids = [...selected];
  const single = ids.length === 1 ? ids[0] : null;

  return (
    <div className="space-y-4">
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded border bg-white p-2 text-sm shadow-sm">
          <span className="font-medium">{labels.selected.replace("{count}", String(selected.size))}</span>
          <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="rounded border px-2 py-1">
            <option value="">{labels.noSection}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button disabled={pending} className="rounded border px-2 py-1"
            onClick={() => run(() => movePhotosAction({ galleryId, photoIds: ids, sectionId: moveTarget || null }))}>
            {labels.move}
          </button>
          <button disabled={pending} className="rounded border px-2 py-1"
            onClick={() => run(() => setPublishedAction({ galleryId, photoIds: ids, published: true }))}>
            {labels.publish}
          </button>
          <button disabled={pending} className="rounded border px-2 py-1"
            onClick={() => run(() => setPublishedAction({ galleryId, photoIds: ids, published: false }))}>
            {labels.hide}
          </button>
          {single && (
            <button disabled={pending} className="rounded border px-2 py-1"
              onClick={() => run(() => setCoverAction({ galleryId, photoId: single }))}>
              {labels.setCover}
            </button>
          )}
          <button disabled={pending} className="rounded border px-2 py-1 text-red-600"
            onClick={() => {
              if (confirm(labels.deleteConfirm.replace("{count}", String(selected.size)))) {
                void run(() => deletePhotosAction({ galleryId, photoIds: ids }));
              }
            }}>
            {labels.delete}
          </button>
          <button disabled={pending} className="ml-auto px-2 py-1 text-neutral-500"
            onClick={() => setSelected(new Set())}>
            {labels.clear}
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative select-none space-y-6"
      >
        {band && (
          <div className="pointer-events-none absolute z-20 border border-blue-400 bg-blue-200/20"
            style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />
        )}
        {photos.length === 0 && <p className="text-sm text-neutral-500">{labels.empty}</p>}
        {groups.map((group) => (
          <section key={group.id ?? "none"}>
            <h3 className="mb-2 text-sm font-medium text-neutral-600">{group.name}</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {group.photos.map((p) => (
                <figure
                  key={p.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(p.id, el);
                    else itemRefs.current.delete(p.id);
                  }}
                  onClick={(e) => toggle(p.id, e.metaKey || e.ctrlKey || e.shiftKey)}
                  onDoubleClick={() => p.webUrl && setLightbox(p)}
                  className={`relative cursor-pointer overflow-hidden rounded border bg-neutral-100 ${
                    selected.has(p.id) ? "ring-2 ring-blue-500" : ""
                  }`}
                >
                  {p.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbUrl} alt={p.filename} className="aspect-square w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-xs text-neutral-400">
                      {p.status === "error" ? labels.errorBadge : labels.processingBadge}
                    </div>
                  )}
                  <figcaption className="truncate px-1 py-0.5 text-[10px] text-neutral-500">{p.filename}</figcaption>
                  <div className="absolute left-1 top-1 flex gap-1">
                    {coverPhotoId === p.id && <span className="rounded bg-amber-400 px-1 text-[10px]">★</span>}
                    {!p.published && (
                      <span className="rounded bg-neutral-800/80 px-1 text-[10px] text-white">{labels.hiddenBadge}</span>
                    )}
                    {p.status === "error" && (
                      <span className="rounded bg-red-600 px-1 text-[10px] text-white">{labels.errorBadge}</span>
                    )}
                  </div>
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.webUrl!} alt={lightbox.filename} className="max-h-full max-w-full object-contain" />
          <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/80">{lightbox.filename}</p>
        </div>
      )}
    </div>
  );
}
