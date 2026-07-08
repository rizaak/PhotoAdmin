"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveWatermarkAction, deleteWatermarkAction } from "./actions";
import type { Placement } from "@/server/watermarks";

export type SlotState = {
  slot: number;
  type: "text" | "image";
  text: string;
  imageKey: string | null;
  opacityPct: number;
  sizePct: number;
  placement: string;
  saved: boolean;
};

export type EditorLabels = {
  intro: string; regenNote: string; add: string; slot: string;
  typeText: string; typeImage: string; textPlaceholder: string;
  uploadPng: string; uploading: string; replacePng: string; invalidPng: string;
  opacity: string; size: string; position: string; tile: string;
  save: string; delete: string; saved: string; incomplete: string; error: string;
};

const GRID: string[][] = [["tl", "tc", "tr"], ["ml", "center", "mr"], ["bl", "bc", "br"]];

function newSlot(slot: number): SlotState {
  return { slot, type: "text", text: "", imageKey: null, opacityPct: 40, sizePct: 20, placement: "br", saved: false };
}

export function WatermarkEditor({
  initial, labels, onChange,
}: {
  initial: SlotState[];
  labels: EditorLabels;
  onChange?: (slots: SlotState[]) => void; // el preview (Task 5) se cuelga de aquí
}) {
  const [slots, setSlots] = useState<SlotState[]>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Record<number, string>>({});
  const router = useRouter();

  function update(slot: number, patch: Partial<SlotState>) {
    setSlots((prev) => {
      const next = prev.map((s) => (s.slot === slot ? { ...s, ...patch, saved: false } : s));
      onChange?.(next);
      return next;
    });
  }

  async function uploadPng(slot: number, file: File) {
    if (file.type !== "image/png" || file.size > 5 * 1024 * 1024) {
      setStatus((p) => ({ ...p, [slot]: labels.invalidPng }));
      return;
    }
    setBusy(true);
    setStatus((p) => ({ ...p, [slot]: labels.uploading }));
    try {
      const res = await fetch("/api/watermarks/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, contentType: "image/png" }),
      });
      if (!res.ok) throw new Error();
      const { uploadUrl, key } = (await res.json()) as { uploadUrl: string; key: string };
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: file });
      if (!put.ok) throw new Error();
      update(slot, { imageKey: key });
      setStatus((p) => ({ ...p, [slot]: "" }));
    } catch {
      setStatus((p) => ({ ...p, [slot]: labels.error }));
    } finally {
      setBusy(false);
    }
  }

  async function save(state: SlotState) {
    const valid = state.type === "text" ? state.text.trim().length > 0 : !!state.imageKey;
    if (!valid) {
      setStatus((p) => ({ ...p, [state.slot]: labels.incomplete }));
      return;
    }
    setBusy(true);
    try {
      await saveWatermarkAction({
        slot: state.slot,
        type: state.type,
        text: state.type === "text" ? state.text.trim() : null,
        imageKey: state.type === "image" ? state.imageKey : null,
        opacityPct: state.opacityPct,
        sizePct: state.sizePct,
        placement: state.placement as Placement,
      });
      update(state.slot, { saved: true });
      setStatus((p) => ({ ...p, [state.slot]: labels.saved }));
      router.refresh();
    } catch {
      setStatus((p) => ({ ...p, [state.slot]: labels.error }));
    } finally {
      setBusy(false);
    }
  }

  async function remove(slot: number) {
    setBusy(true);
    try {
      const target = slots.find((s) => s.slot === slot);
      if (target?.saved !== false || initial.some((s) => s.slot === slot)) {
        await deleteWatermarkAction({ slot });
      }
      setSlots((prev) => {
        const next = prev.filter((s) => s.slot !== slot);
        onChange?.(next);
        return next;
      });
      router.refresh();
    } catch {
      setStatus((p) => ({ ...p, [slot]: labels.error }));
    } finally {
      setBusy(false);
    }
  }

  function addSlot() {
    const used = new Set(slots.map((s) => s.slot));
    const free = [0, 1, 2].find((n) => !used.has(n));
    if (free === undefined) return;
    setSlots((prev) => {
      const next = [...prev, newSlot(free)].sort((a, b) => a.slot - b.slot);
      onChange?.(next);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">{labels.intro}</p>
      <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">{labels.regenNote}</p>

      {slots.map((s) => (
        <div key={s.slot} className="space-y-3 rounded border bg-white p-4 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">{labels.slot.replace("{n}", String(s.slot + 1))}</h3>
            <button onClick={() => void remove(s.slot)} disabled={busy} className="text-red-600 hover:underline">
              {labels.delete}
            </button>
          </div>

          <div className="flex gap-3">
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`wm-type-${s.slot}`} checked={s.type === "text"} onChange={() => update(s.slot, { type: "text" })} />
              {labels.typeText}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`wm-type-${s.slot}`} checked={s.type === "image"} onChange={() => update(s.slot, { type: "image" })} />
              {labels.typeImage}
            </label>
          </div>

          {s.type === "text" ? (
            <input
              value={s.text} onChange={(e) => update(s.slot, { text: e.target.value })}
              maxLength={100} placeholder={labels.textPlaceholder}
              className="w-full rounded border px-3 py-1.5"
            />
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5">
              {s.imageKey ? labels.replacePng : labels.uploadPng}
              <input
                type="file" accept="image/png" className="hidden" disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadPng(s.slot, f);
                }}
              />
              {s.imageKey && <span className="text-xs text-green-700">✓</span>}
            </label>
          )}

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              {labels.opacity}: {s.opacityPct}%
              <input type="range" min={5} max={100} value={s.opacityPct}
                onChange={(e) => update(s.slot, { opacityPct: Number(e.target.value) })} />
            </label>
            <label className="flex flex-col gap-1">
              {labels.size}: {s.sizePct}%
              <input type="range" min={5} max={50} value={s.sizePct}
                onChange={(e) => update(s.slot, { sizePct: Number(e.target.value) })} />
            </label>
          </div>

          <div className="flex items-center gap-4">
            <span>{labels.position}:</span>
            <div className="grid grid-cols-3 gap-1">
              {GRID.flat().map((pos) => (
                <button
                  key={pos}
                  onClick={() => update(s.slot, { placement: pos })}
                  className={`h-6 w-6 rounded border ${s.placement === pos ? "bg-neutral-900" : "bg-neutral-100 hover:bg-neutral-300"}`}
                  aria-label={pos}
                />
              ))}
            </div>
            <button
              onClick={() => update(s.slot, { placement: "tile" })}
              className={`rounded border px-2 py-1 text-xs ${s.placement === "tile" ? "bg-neutral-900 text-white" : ""}`}
            >
              {labels.tile}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => void save(s)} disabled={busy}
              className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">
              {labels.save}
            </button>
            {status[s.slot] && <span className="text-xs text-neutral-600">{status[s.slot]}</span>}
          </div>
        </div>
      ))}

      {slots.length < 3 && (
        <button onClick={addSlot} disabled={busy} className="rounded border px-3 py-1.5 text-sm">
          {labels.add}
        </button>
      )}
    </div>
  );
}
