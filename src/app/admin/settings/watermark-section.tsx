"use client";

import { useState } from "react";
import { WatermarkEditor, type SlotState, type EditorLabels } from "./watermark-editor";
import { WatermarkPreview } from "./watermark-preview";

export function WatermarkSection({
  initial, labels, previewLabels,
}: {
  initial: SlotState[];
  labels: EditorLabels;
  previewLabels: { preview: string; previewLoading: string; previewError: string; previewPick: string };
}) {
  const [slots, setSlots] = useState<SlotState[]>(initial);
  const [previewSlot, setPreviewSlot] = useState<number | null>(initial[0]?.slot ?? null);
  const active = slots.find((s) => s.slot === previewSlot) ?? slots[0];
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <WatermarkEditor initial={initial} labels={labels} onChange={setSlots} />
      <div className="space-y-2">
        {slots.length > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-neutral-600">{previewLabels.previewPick}</span>
            {slots.map((s) => (
              <button
                key={s.slot} type="button" onClick={() => setPreviewSlot(s.slot)}
                className={`rounded border px-2 py-0.5 ${active?.slot === s.slot ? "bg-neutral-900 text-white" : ""}`}
              >
                {s.slot + 1}
              </button>
            ))}
          </div>
        )}
        <WatermarkPreview slots={active ? [active] : []} labels={previewLabels} />
      </div>
    </div>
  );
}
