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
  const abortController = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    abortController.current = new AbortController();
    const controller = abortController.current;

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
            signal: controller.signal,
          });
          if (!res.ok) throw new Error();
          const blob = await res.blob();
          setUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            const newUrl = URL.createObjectURL(blob);
            urlRef.current = newUrl;
            return newUrl;
          });
          setState("idle");
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            return;
          }
          setState("error");
        }
      })();
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (abortController.current) {
        abortController.current.abort();
      }
    };
  }, [slots]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

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
