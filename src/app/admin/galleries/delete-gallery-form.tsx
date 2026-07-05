"use client";

import { deleteGalleryAction } from "./actions";

export function DeleteGalleryForm({
  galleryId,
  label,
  confirmMessage,
}: {
  galleryId: string;
  label: string;
  confirmMessage: string;
}) {
  return (
    <form
      action={deleteGalleryAction}
      onSubmit={(e) => {
        if (!confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <input type="hidden" name="galleryId" value={galleryId} />
      <button className="text-sm text-red-600 hover:underline">{label}</button>
    </form>
  );
}
