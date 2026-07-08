"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PALETTE_TOKENS, FONT_TOKENS, type GalleryDesign } from "./design-options";
import { IconDownload } from "./icons";

type Res = "web" | "high" | "original";

export function GalleryHeader({
  design, title, sentinel, zip, resolution, onResolutionChange, labels, onZip,
}: {
  design: GalleryDesign; title: string;
  sentinel: React.RefObject<HTMLElement | null>;
  zip: { enabled: boolean; resolutions: Res[] };
  resolution: Res; onResolutionChange: (r: Res) => void;
  labels: { downloadGallery: string; downloadFavorites: string; resolutions: Record<Res, string> };
  onZip: (scope: { type: "gallery" | "favorites" }, resolution: Res) => void;
}) {
  const pt = PALETTE_TOKENS[design.palette];
  const ft = FONT_TOKENS[design.fontSet];
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [sentinel]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          initial={{ y: -48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -48, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b px-5 py-2.5 backdrop-blur-md"
          style={{ background: pt.dark ? "rgba(14,14,16,.82)" : "rgba(255,255,255,.85)",
            borderColor: pt.dark ? "#26262a" : "#eee", color: pt.text }}
        >
          <span className="truncate text-sm" style={{ fontFamily: ft.display, fontStyle: ft.displayStyle,
            textTransform: ft.displayTransform, letterSpacing: ft.displayTracking }}>
            {title}
          </span>
          {zip.enabled && zip.resolutions.length > 0 && (
            <div className="relative" ref={menuRef}>
              <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
                style={{ borderColor: pt.dark ? "#3a3a40" : "#ddd" }}>
                <IconDownload className="h-4 w-4" />
              </button>
              {open && (
                <div role="menu"
                  className="absolute right-0 mt-2 w-56 space-y-2 rounded-lg border p-3 text-sm shadow-xl"
                  style={{ background: pt.surface, borderColor: pt.dark ? "#3a3a40" : "#e5e5e5", color: pt.text }}>
                  <select value={resolution} onChange={(e) => onResolutionChange(e.target.value as Res)}
                    className="w-full rounded border bg-transparent px-2 py-1.5 text-xs"
                    style={{ borderColor: pt.dark ? "#3a3a40" : "#ddd" }}>
                    {zip.resolutions.map((r) => <option key={r} value={r}>{labels.resolutions[r]}</option>)}
                  </select>
                  <button role="menuitem" onClick={() => { setOpen(false); onZip({ type: "gallery" }, resolution); }}
                    className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70">
                    {labels.downloadGallery}
                  </button>
                  <button role="menuitem" onClick={() => { setOpen(false); onZip({ type: "favorites" }, resolution); }}
                    className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70">
                    {labels.downloadFavorites}
                  </button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
