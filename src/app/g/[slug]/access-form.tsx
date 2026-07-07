"use client";

import { useActionState } from "react";
import { enterGalleryAction, type EnterState } from "./actions";

type Labels = {
  welcome: string; emailLabel: string; nameLabel: string; passwordLabel: string;
  enter: string; invalidPassword: string; tooManyAttempts: string; genericError: string;
};

export function AccessForm({
  slug, galleryTitle, hasPassword, labels,
}: {
  slug: string; galleryTitle: string; hasPassword: boolean; labels: Labels;
}) {
  const action = enterGalleryAction.bind(null, slug);
  const [state, formAction, pending] = useActionState<EnterState, FormData>(action, null);

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-8 shadow">
        <p className="text-sm text-neutral-500">{labels.welcome}</p>
        <h1 className="text-2xl font-semibold">{galleryTitle}</h1>
        <input
          name="email" type="email" required placeholder={labels.emailLabel}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <input
          name="name" placeholder={labels.nameLabel}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        {hasPassword && (
          <input
            name="password" type="password" required placeholder={labels.passwordLabel}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        )}
        {state?.error && (
          <p className="text-sm text-red-600">{labels[state.error]}</p>
        )}
        <button disabled={pending} className="w-full rounded bg-neutral-900 py-2 text-sm text-white disabled:opacity-50">
          {labels.enter}
        </button>
      </form>
    </main>
  );
}
