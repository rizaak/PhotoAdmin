"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  COVER_STYLES, FONT_SETS, PALETTES, GRID_STYLES,
  type CoverStyle, type FontSet, type Palette, type GridStyle,
} from "@/db/schema";
import { updateGalleryDesignAction } from "./actions";

export type DesignLabels = {
  title: string;
  groups: { coverStyle: string; fontSet: string; palette: string; gridStyle: string };
  coverStyleNames: Record<CoverStyle, string>;
  fontSetNames: Record<FontSet, string>;
  paletteNames: Record<Palette, string>;
  gridStyleNames: Record<GridStyle, string>;
  focalHint: string;
  upload: string;
  remove: string;
  save: string;
  saved: string;
  error: string;
};

type Design = { coverStyle: CoverStyle; fontSet: FontSet; palette: Palette; gridStyle: GridStyle };

function Group<T extends string>({
  legend, options, value, names, onChange,
}: {
  legend: string; options: readonly T[]; value: T; names: Record<T, string>; onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-neutral-500">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`rounded border px-3 py-1.5 text-sm ${
              value === opt
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white hover:bg-neutral-50"
            }`}
          >
            {names[opt]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function DesignSection({
  galleryId, design, focal, coverThumbUrl, labels,
}: {
  galleryId: string;
  design: Design;
  focal: { x: number; y: number };
  coverThumbUrl: string | null;
  labels: DesignLabels;
}) {
  const [coverStyle, setCoverStyle] = useState<CoverStyle>(design.coverStyle);
  const [fontSet, setFontSet] = useState<FontSet>(design.fontSet);
  const [palette, setPalette] = useState<Palette>(design.palette);
  const [gridStyle, setGridStyle] = useState<GridStyle>(design.gridStyle);
  const [focalPoint, setFocalPoint] = useState(focal);
  const [thumbUrl, setThumbUrl] = useState(coverThumbUrl);
  // undefined = sin cambio en la portada subida; null = quitarla; string = nueva key subida
  const [pendingCoverKey, setPendingCoverKey] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const router = useRouter();

  async function uploadCover(file: File) {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setStatus(labels.error);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/covers/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ galleryId, contentType: file.type, size: file.size }),
      });
      if (!res.ok) throw new Error();
      const { uploadUrl, key } = (await res.json()) as { uploadUrl: string; key: string };
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error();
      setPendingCoverKey(key);
      setThumbUrl(URL.createObjectURL(file));
      setStatus("");
    } catch {
      setStatus(labels.error);
    } finally {
      setBusy(false);
    }
  }

  function removeCover() {
    setPendingCoverKey(null);
    setThumbUrl(null);
  }

  async function save() {
    setBusy(true);
    try {
      await updateGalleryDesignAction({
        galleryId,
        coverStyle, fontSet, palette, gridStyle,
        coverFocalX: focalPoint.x, coverFocalY: focalPoint.y,
        ...(pendingCoverKey !== undefined ? { coverImageKey: pendingCoverKey } : {}),
      });
      setPendingCoverKey(undefined);
      setStatus(labels.saved);
      router.refresh();
    } catch {
      setStatus(labels.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded border bg-white p-4">
      <h2 className="mb-4 font-medium">{labels.title}</h2>
      <div className="space-y-6">
        <Group legend={labels.groups.coverStyle} options={COVER_STYLES} value={coverStyle}
          names={labels.coverStyleNames} onChange={setCoverStyle} />
        <Group legend={labels.groups.fontSet} options={FONT_SETS} value={fontSet}
          names={labels.fontSetNames} onChange={setFontSet} />
        <Group legend={labels.groups.palette} options={PALETTES} value={palette}
          names={labels.paletteNames} onChange={setPalette} />
        <Group legend={labels.groups.gridStyle} options={GRID_STYLES} value={gridStyle}
          names={labels.gridStyleNames} onChange={setGridStyle} />

        <div className="space-y-2">
          <div
            className="relative aspect-video w-full max-w-sm cursor-crosshair overflow-hidden rounded border bg-neutral-100"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setFocalPoint({
                x: (e.clientX - rect.left) / rect.width,
                y: (e.clientY - rect.top) / rect.height,
              });
            }}
          >
            {thumbUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbUrl} alt="" draggable={false} className="h-full w-full object-cover" />
            )}
            <div
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-neutral-900 shadow"
              style={{ left: `${focalPoint.x * 100}%`, top: `${focalPoint.y * 100}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500">{labels.focalHint}</p>
          <div className="flex items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm">
              {labels.upload}
              <input
                type="file" accept="image/jpeg,image/png" className="hidden" disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadCover(f);
                }}
              />
            </label>
            {thumbUrl && (
              <button type="button" onClick={removeCover} disabled={busy} className="text-sm text-red-600 hover:underline">
                {labels.remove}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button" onClick={() => void save()} disabled={busy}
            className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {labels.save}
          </button>
          {status && <span className="text-xs text-neutral-600">{status}</span>}
        </div>
      </div>
    </section>
  );
}
