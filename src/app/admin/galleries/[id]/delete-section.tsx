"use client";

import { useState } from "react";
import { deleteSectionAction } from "./actions";

type Labels = {
  delete: string;
  deleteMoveTo: string;
  deleteConfirmMove: string;
  deleteBlocked: string;
};

export function DeleteSection({
  galleryId, sectionId, photoCount, otherSections, labels,
}: {
  galleryId: string;
  sectionId: string;
  photoCount: number;
  otherSections: { id: string; name: string }[];
  labels: Labels;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(otherSections[0]?.id ?? "");

  if (photoCount === 0) {
    return (
      <form action={deleteSectionAction}>
        <input type="hidden" name="galleryId" value={galleryId} />
        <input type="hidden" name="sectionId" value={sectionId} />
        <button className="text-red-600 hover:underline">{labels.delete}</button>
      </form>
    );
  }

  if (otherSections.length === 0) {
    return (
      <button type="button" disabled className="text-neutral-400" title={labels.deleteBlocked}>
        {labels.delete}
      </button>
    );
  }

  if (!open) {
    return (
      <button type="button" className="text-red-600 hover:underline" onClick={() => setOpen(true)}>
        {labels.delete}
      </button>
    );
  }

  return (
    <form action={deleteSectionAction} className="flex items-center gap-1 text-xs">
      <input type="hidden" name="galleryId" value={galleryId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="moveToSectionId" value={target} />
      <label className="flex items-center gap-1">
        {labels.deleteMoveTo}
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded border px-1 py-0.5"
        >
          {otherSections.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>
      <button className="text-red-600 hover:underline">{labels.deleteConfirmMove}</button>
    </form>
  );
}
