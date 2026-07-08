"use client";

import { useEffect, useRef, useState } from "react";
import type { SlotState } from "./watermark-editor";

export function WatermarkPreview({
  slots, labels,
}: {
  slots: SlotState[];
  labels: { preview: string; previewLoading: string; previewError: string };
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        setState("loading");
        try {
          const res = await fetch("/api/watermarks/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              specs: slots.map((s) => ({
                type: s.type,
                text: s.type === "text" ? s.text.trim() || null : null,
                imageKey: s.type === "image" ? s.imageKey : null,
                opacityPct: s.opacityPct,
                sizePct: s.sizePct,
                placement: s.placement,
              })),
            }),
          });
          if (!res.ok) throw new Error();
          const blob = await res.blob();
          setUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return URL.createObjectURL(blob);
          });
          setState("idle");
        } catch {
          setState("error");
        }
      })();
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [slots]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{labels.preview}</h3>
      <div className="relative overflow-hidden rounded border bg-neutral-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt={labels.preview} className="w-full" />}
        {!url && <div className="aspect-[3/2] w-full" />}
        {state === "loading" && (
          <span className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
            {labels.previewLoading}
          </span>
        )}
      </div>
      {state === "error" && <p className="text-xs text-red-600">{labels.previewError}</p>}
    </div>
  );
}
