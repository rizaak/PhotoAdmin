"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Labels = {
  hint: string; select: string; target: string; needSection: string;
  uploading: string; processing: string; done: string; error: string;
};
type ItemStatus = "pending" | "uploading" | "processing" | "done" | "error";
type Item = { name: string; status: ItemStatus };

export function PhotoUploader({
  galleryId, sections, labels,
}: {
  galleryId: string;
  sections: { id: string; name: string }[];
  labels: Labels;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [sectionId, setSectionId] = useState<string>(sections[0]?.id ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const noSections = sections.length === 0;

  async function uploadOne(file: File, index: number) {
    const set = (status: ItemStatus) =>
      setItems((prev) => prev.map((it, i) => (i === index ? { ...it, status } : it)));
    try {
      set("uploading");
      const res = await fetch(`/api/galleries/${galleryId}/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          size: file.size,
          contentType: file.type,
          sectionId,
        }),
      });
      if (!res.ok) throw new Error();
      const { photoId, uploadUrl } = (await res.json()) as { photoId: string; uploadUrl: string };

      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error();

      set("processing");
      const done = await fetch(`/api/photos/${photoId}/complete`, { method: "POST" });
      if (!done.ok) throw new Error();
      set("done");
    } catch {
      set("error");
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || busy || noSections) return;
    const list = Array.from(files);
    setItems(list.map((f) => ({ name: f.name, status: "pending" })));
    setBusy(true);
    let next = 0;
    const CONCURRENCY = 3;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
        while (next < list.length) {
          const i = next++;
          await uploadOne(list[i], i);
        }
      }),
    );
    setBusy(false);
    router.refresh();
  }

  const statusLabel: Record<ItemStatus, string> = {
    pending: "…", uploading: labels.uploading, processing: labels.processing,
    done: labels.done, error: labels.error,
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        {labels.target}
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
          disabled={busy || noSections}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void handleFiles(e.dataTransfer.files); }}
        className="rounded border-2 border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500"
      >
        {noSections ? (
          labels.needSection
        ) : (
          <>
            {labels.hint}{" "}
            <button type="button" onClick={() => inputRef.current?.click()} className="text-neutral-900 underline" disabled={busy}>
              {labels.select}
            </button>
          </>
        )}
        <input
          ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={noSections}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-neutral-600">
          {items.map((it, i) => (
            <li key={i} className="flex justify-between">
              <span className="truncate">{it.name}</span>
              <span className={it.status === "error" ? "text-red-600" : ""}>{statusLabel[it.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
