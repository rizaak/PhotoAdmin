"use client";

import { useEffect, useRef, useState } from "react";
import type { GalleryDesign } from "./design-options";
import { PALETTE_TOKENS, FONT_TOKENS } from "./design-options";
import { IconHeart, IconDownload } from "./icons";

type Res = "web" | "high" | "original";

export function TitleBar({
  design, title, sections, activeSectionId, onSelectSection,
  favoritesOnly, onToggleFavorites, zip, zipResolution, onZipResolution, onZip,
  sentinel, labels, previewMode = false,
}: {
  design: GalleryDesign; title: string;
  sections: { id: string; name: string }[];
  activeSectionId: string | null; onSelectSection: (id: string) => void;
  favoritesOnly: boolean; onToggleFavorites: () => void;
  zip: { enabled: boolean; resolutions: Res[] };
  zipResolution: Res; onZipResolution: (r: Res) => void;
  onZip: (scope: { type: "gallery" | "favorites" } | { type: "section"; sectionId: string }) => void;
  sentinel: React.RefObject<HTMLElement | null>;
  labels: { favorites: string; downloadGallery: string; downloadFavorites: string; downloadSection: string;
    resolutions: Record<Res, string>; previewOnly?: string };
  previewMode?: boolean;
}) {
  const pt = PALETTE_TOKENS[design.palette];
  const ft = FONT_TOKENS[design.fontSet];
  const [stuck, setStuck] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [sentinel]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const tab = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs transition-colors ${active ? "" : "hover:opacity-70"}`;

  return (
    <div
      className={`z-40 border-b px-5 py-3 backdrop-blur-md transition-shadow ${
        stuck ? `fixed inset-x-0 ${previewMode ? "top-9" : "top-0"} shadow-sm` : "relative"}`}
      style={{ background: pt.dark ? "rgba(14,14,16,.88)" : "rgba(255,255,255,.88)",
        borderColor: pt.dark ? "#26262a" : "#eee", color: pt.text }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <span className="truncate text-base" style={{ fontFamily: ft.display, fontStyle: ft.displayStyle,
          textTransform: ft.displayTransform, letterSpacing: ft.displayTracking, fontWeight: ft.displayWeight }}>
          {title}
        </span>
        <div className="flex items-center gap-2">
          <button aria-label={labels.favorites} aria-pressed={favoritesOnly} onClick={onToggleFavorites}
            className="rounded-full border p-2" style={{ borderColor: pt.dark ? "#3a3a40" : "#ddd",
              background: favoritesOnly ? pt.accent : "transparent",
              color: favoritesOnly ? (pt.dark ? "#0e0e10" : "#fff") : pt.text }}>
            <IconHeart filled={favoritesOnly} className="h-4 w-4" />
          </button>
          {zip.enabled && zip.resolutions.length > 0 && (
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}
                disabled={previewMode} aria-disabled={previewMode}
                title={previewMode ? labels.previewOnly : undefined}
                className="rounded-full border p-2 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ borderColor: pt.dark ? "#3a3a40" : "#ddd" }}>
                <IconDownload className="h-4 w-4" />
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 mt-2 w-60 space-y-2 rounded-lg border p-3 text-sm shadow-xl"
                  style={{ background: pt.surface, borderColor: pt.dark ? "#3a3a40" : "#e5e5e5" }}>
                  <select value={zipResolution} onChange={(e) => onZipResolution(e.target.value as Res)}
                    className="w-full rounded border bg-transparent px-2 py-1.5 text-xs"
                    style={{ borderColor: pt.dark ? "#3a3a40" : "#ddd" }}>
                    {zip.resolutions.map((r) => <option key={r} value={r}>{labels.resolutions[r]}</option>)}
                  </select>
                  <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70"
                    onClick={() => { setMenu(false); onZip({ type: "gallery" }); }}>{labels.downloadGallery}</button>
                  <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70"
                    onClick={() => { setMenu(false); onZip({ type: "favorites" }); }}>{labels.downloadFavorites}</button>
                  {activeSectionId && (
                    <button role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:opacity-70"
                      onClick={() => { setMenu(false); onZip({ type: "section", sectionId: activeSectionId }); }}>
                      {labels.downloadSection}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {sections.length > 1 && (
        <nav role="tablist" className="mx-auto mt-2 flex max-w-6xl flex-wrap gap-1.5">
          {sections.map((s) => (
            <button key={s.id} onClick={() => onSelectSection(s.id)} role="tab" aria-selected={activeSectionId === s.id} className={tab(activeSectionId === s.id)}
              style={activeSectionId === s.id ? { background: pt.accent, color: pt.dark ? "#0e0e10" : "#fff" } : { color: pt.muted }}>
              {s.name}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
