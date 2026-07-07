"use client";

import { useActionState } from "react";
import { createSectionFromSelectionAction, type SelectionState } from "./actions";

type Labels = {
  createSection: string; sectionName: string; selectClients: string;
  hideOthers: string; create: string; created: string; emptySelection: string;
  selectAtLeastOne: string;
};

export function SelectionForm({
  galleryId, clients, labels,
}: {
  galleryId: string;
  clients: { clientId: string; email: string }[];
  labels: Labels;
}) {
  const [state, formAction, pending] = useActionState<SelectionState, FormData>(
    createSectionFromSelectionAction, null,
  );

  return (
    <form action={formAction} className="space-y-3 rounded border bg-white p-4 text-sm">
      <h2 className="font-medium">{labels.createSection}</h2>
      <input type="hidden" name="galleryId" value={galleryId} />
      <p className="text-neutral-600">{labels.selectClients}</p>
      <div className="flex flex-wrap gap-3">
        {clients.map((c) => (
          <label key={c.clientId} className="flex items-center gap-1.5">
            <input type="checkbox" name="clientIds" value={c.clientId} className="h-4 w-4 accent-neutral-900" />
            {c.email}
          </label>
        ))}
      </div>
      <input name="name" required placeholder={labels.sectionName} className="w-64 rounded border px-3 py-1.5" />
      <label className="flex items-center gap-2">
        <input type="checkbox" name="hideOthers" className="h-4 w-4 accent-neutral-900" />
        {labels.hideOthers}
      </label>
      {state && "created" in state && (
        <p className="text-green-700">{labels.created.replace("{count}", String(state.created))}</p>
      )}
      {state && "error" in state && (
        <p className="text-red-600">
          {state.error === "selectAtLeastOne" ? labels.selectAtLeastOne : labels.emptySelection}
        </p>
      )}
      <button disabled={pending} className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-50">
        {labels.create}
      </button>
    </form>
  );
}
