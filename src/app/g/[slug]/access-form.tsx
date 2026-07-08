"use client";

import { useActionState } from "react";
import { motion } from "motion/react";
import type { GalleryTemplate } from "@/db/schema";
import { TEMPLATE_TOKENS } from "./templates";
import { fontVariables } from "./fonts";
import { enterGalleryAction, type EnterState } from "./actions";

type Labels = {
  welcome: string; emailLabel: string; nameLabel: string; passwordLabel: string;
  enter: string; invalidPassword: string; tooManyAttempts: string; genericError: string;
};

export function AccessForm({
  slug, galleryTitle, hasPassword, template, coverUrl, labels,
}: {
  slug: string; galleryTitle: string; hasPassword: boolean;
  template: GalleryTemplate; coverUrl: string | null; labels: Labels;
}) {
  const tk = TEMPLATE_TOKENS[template];
  const action = enterGalleryAction.bind(null, slug);
  const [state, formAction, pending] = useActionState<EnterState, FormData>(action, null);

  const input =
    "w-full border-0 border-b bg-transparent px-1 py-2 text-sm outline-none focus:border-current";

  return (
    <main
      className={`relative flex min-h-screen items-center justify-center overflow-hidden p-6 ${fontVariables}`}
      style={{ background: tk.bg, color: tk.text, fontFamily: tk.body }}
    >
      {coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" draggable={false} aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-md brightness-[.55]" />
      )}
      <motion.form
        action={formAction}
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
        className="relative w-full max-w-sm space-y-5 rounded-xl p-9 shadow-2xl backdrop-blur-md"
        style={{ background: coverUrl ? "rgba(255,255,255,.92)" : tk.surface, color: coverUrl ? "#1f1f1f" : tk.text }}
      >
        <p className="text-xs" style={{ color: tk.accent, letterSpacing: "0.25em", textTransform: "uppercase" }}>
          {labels.welcome}
        </p>
        <h1
          className="text-3xl leading-snug"
          style={{ fontFamily: tk.display, fontWeight: tk.displayWeight, fontStyle: tk.displayStyle,
            textTransform: tk.displayTransform, letterSpacing: tk.displayTracking }}
        >
          {galleryTitle}
        </h1>
        <input name="email" type="email" required placeholder={labels.emailLabel} className={input} />
        <input name="name" placeholder={labels.nameLabel} className={input} />
        {hasPassword && (
          <input name="password" type="password" required placeholder={labels.passwordLabel} className={input} />
        )}
        {state?.error && <p className="text-sm text-red-600">{labels[state.error]}</p>}
        <button
          disabled={pending}
          className="w-full rounded-full py-2.5 text-sm text-white transition-opacity disabled:opacity-50"
          style={{ background: tk.dark ? tk.accent : "#1a1a1a" }}
        >
          {labels.enter}
        </button>
      </motion.form>
    </main>
  );
}
