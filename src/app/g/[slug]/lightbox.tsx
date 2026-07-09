"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { IconClose, IconPrev, IconNext, IconHeart, IconComment, IconDownload } from "./icons";
import type { ClientPhoto } from "./client-gallery";

type Res = "web" | "high" | "original";
type Labels = {
  close: string; prev: string; next: string; like: string; unlike: string;
  comments: string; commentPlaceholder: string; send: string; download: string;
  resolutions: Record<Res, string>; actionError: string;
  previewOnly?: string;
};

export function Lightbox({
  photos, openId, busy, labels, onClose, onNavigate, onToggleLike, onDownload, onComment,
  previewMode = false,
}: {
  photos: ClientPhoto[]; openId: string | null; busy: boolean; labels: Labels;
  onClose: () => void; onNavigate: (id: string) => void;
  onToggleLike: (p: ClientPhoto) => void;
  onDownload: (p: ClientPhoto, res: Res) => Promise<void>;
  onComment: (p: ClientPhoto, body: string) => Promise<void>;
  previewMode?: boolean;
}) {
  const reduce = useReducedMotion();
  const idx = photos.findIndex((p) => p.id === openId);
  const photo = idx >= 0 ? photos[idx] : null;
  const [controls, setControls] = useState(true);
  const [panel, setPanel] = useState<"none" | "comment" | "download">("none");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [prevOpenId, setPrevOpenId] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 2500);
  }, []);

  // Reset per-photo UI state on every openId transition (navigation AND
  // close→reopen, even of the same photo — the component never unmounts).
  // Done during render (React's documented "adjust state on prop change"
  // pattern) so the reset isn't a synchronous setState-in-effect.
  if (openId !== prevOpenId) {
    setPrevOpenId(openId);
    if (photo) {
      setControls(true);
      setPanel("none");
      setDraft(photo.comment?.body ?? "");
      setError(null);
    }
  }

  useEffect(() => {
    if (!photo) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 2500);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, [photo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((dir: 1 | -1) => {
    if (idx < 0) return;
    const next = photos[idx + dir];
    if (next) onNavigate(next.id);
  }, [idx, photos, onNavigate]);

  useEffect(() => {
    if (!photo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (panel !== "none") setPanel("none");
        else onClose();
        return;
      }
      // Don't hijack arrow keys while typing in the comment textarea.
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photo, panel, go, onClose]);

  if (!photo) return null;
  const fail = (msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 3500);
  };
  const pill = "flex items-center justify-center rounded-full bg-neutral-900/55 p-3 text-white backdrop-blur-md";

  return (
    <AnimatePresence>
      <motion.div
        key="lb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black"
        onMouseMove={poke} onTouchStart={(e) => { poke(); touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
        onTouchEnd={(e) => {
          const t = touch.current; touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
          else if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
        }}
      >
        <div className="flex h-full items-center justify-center" onClick={onClose}>
          <motion.img
            layoutId={reduce ? undefined : `photo-${photo.id}`}
            src={photo.webUrl} alt={photo.filename} draggable={false}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        <AnimatePresence>
          {controls && (
            <motion.div key="ctl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <button aria-label={labels.close} onClick={onClose} className={`${pill} absolute right-4 top-4`}>
                <IconClose className="h-4 w-4" />
              </button>
              {idx > 0 && (
                <button aria-label={labels.prev} onClick={() => go(-1)}
                  className={`${pill} absolute left-3 top-1/2 -translate-y-1/2`}>
                  <IconPrev className="h-5 w-5" />
                </button>
              )}
              {idx < photos.length - 1 && (
                <button aria-label={labels.next} onClick={() => go(1)}
                  className={`${pill} absolute right-3 top-1/2 -translate-y-1/2`}>
                  <IconNext className="h-5 w-5" />
                </button>
              )}
              <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-3">
                <button aria-label={photo.liked ? labels.unlike : labels.like} className={`${pill} disabled:cursor-not-allowed disabled:opacity-40`}
                  onClick={() => onToggleLike(photo)}
                  disabled={previewMode} aria-disabled={previewMode}
                  title={previewMode ? labels.previewOnly : undefined}>
                  <IconHeart filled={photo.liked} className={`h-[18px] w-[18px] ${photo.liked ? "text-red-400" : ""}`} />
                </button>
                <button aria-label={labels.comments} className={`${pill} disabled:cursor-not-allowed disabled:opacity-40`}
                  onClick={() => setPanel(panel === "comment" ? "none" : "comment")}
                  disabled={previewMode} aria-disabled={previewMode}
                  title={previewMode ? labels.previewOnly : undefined}>
                  <IconComment className="h-[18px] w-[18px]" />
                </button>
                {photo.downloads.length > 0 && (
                  <button aria-label={labels.download} className={`${pill} disabled:cursor-not-allowed disabled:opacity-40`}
                    onClick={() => setPanel(panel === "download" ? "none" : "download")}
                    disabled={previewMode} aria-disabled={previewMode}
                    title={previewMode ? labels.previewOnly : undefined}>
                    <IconDownload className="h-[18px] w-[18px]" />
                  </button>
                )}
              </div>
              {error && (
                <p className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-red-600/85 px-4 py-1.5 text-xs text-white">
                  {error}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {panel === "download" && (
            <motion.div key="dl" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
              className="absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col gap-1 rounded-xl bg-neutral-900/85 p-2 text-sm text-white backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
              {photo.downloads.map((r) => (
                <button key={r} disabled={busy}
                  onClick={() => { setPanel("none"); void onDownload(photo, r).catch(() => fail(labels.actionError)); }}
                  className="rounded-lg px-4 py-1.5 text-left hover:bg-white/10 disabled:opacity-50">
                  {labels.resolutions[r]}
                </button>
              ))}
            </motion.div>
          )}
          {panel === "comment" && (
            <motion.aside key="cm" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              className="absolute inset-y-0 right-0 w-full max-w-xs space-y-3 bg-neutral-900/92 p-5 text-white backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
              <h3 className="text-sm opacity-80">{labels.comments}</h3>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4}
                placeholder={labels.commentPlaceholder}
                className="w-full resize-none rounded-lg border border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-white/50" />
              <button disabled={busy || !draft.trim()}
                onClick={() => void onComment(photo, draft).catch(() => fail(labels.actionError))}
                className="rounded-full bg-white px-4 py-1.5 text-sm text-neutral-900 disabled:opacity-50">
                {labels.send}
              </button>
            </motion.aside>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
