"use client";

import { useState } from "react";

export function ShareLinks({ slug, labels }: { slug: string; labels: { preview: string; copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 text-sm">
      <a href={`/g/${slug}/preview`} target="_blank" rel="noreferrer"
        className="rounded border px-3 py-1.5 hover:bg-neutral-50">{labels.preview}</a>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(`${window.location.origin}/g/${slug}`).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className="rounded border px-3 py-1.5 hover:bg-neutral-50"
      >
        {copied ? labels.copied : labels.copy}
      </button>
    </div>
  );
}
