"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Labels = { pending: string; run: string; running: string; done: string; failed: string };

export function ReprocessPhotos({
  photoIds, labels,
}: {
  photoIds: string[];
  labels: Labels;
}) {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const router = useRouter();

  if (photoIds.length === 0) return null;

  async function run() {
    setState("running");
    let ok = 0;
    let bad = 0;
    for (const id of photoIds) {
      const res = await fetch(`/api/photos/${id}/reprocess`, { method: "POST" }).catch(() => null);
      if (res?.ok) ok++; else bad++;
      setDone(ok + bad);
      setFailed(bad);
    }
    setState("done");
    router.refresh();
  }

  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      {state === "idle" && (
        <div className="flex items-center justify-between gap-3">
          <span>{labels.pending.replace("{count}", String(photoIds.length))}</span>
          <button onClick={() => void run()} className="rounded bg-neutral-900 px-3 py-1.5 text-white">
            {labels.run}
          </button>
        </div>
      )}
      {state === "running" && (
        <div>
          <p>{labels.running.replace("{done}", String(done)).replace("{total}", String(photoIds.length))}</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-neutral-200">
            <div className="h-full bg-neutral-900 transition-all" style={{ width: `${(done / photoIds.length) * 100}%` }} />
          </div>
        </div>
      )}
      {state === "done" && (
        <p>{failed > 0 ? labels.failed.replace("{count}", String(failed)) : labels.done}</p>
      )}
    </div>
  );
}
