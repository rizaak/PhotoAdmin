"use client";

import { useState } from "react";
import { WatermarkEditor, type SlotState, type EditorLabels } from "./watermark-editor";
import { WatermarkPreview } from "./watermark-preview";

export function WatermarkSection({
  initial, labels, previewLabels,
}: {
  initial: SlotState[];
  labels: EditorLabels;
  previewLabels: { preview: string; previewLoading: string; previewError: string };
}) {
  const [slots, setSlots] = useState<SlotState[]>(initial);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <WatermarkEditor initial={initial} labels={labels} onChange={setSlots} />
      <WatermarkPreview slots={slots} labels={previewLabels} />
    </div>
  );
}
