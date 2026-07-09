"use client";

import { useActionState } from "react";
import { motion } from "motion/react";
import { PALETTE_TOKENS, FONT_TOKENS, type GalleryDesign } from "./design-options";
import { fontVariables } from "./fonts";
import { enterGalleryAction, type EnterState } from "./actions";

type Labels = {
  welcome: string; emailLabel: string; nameLabel: string; passwordLabel: string;
  enter: string; invalidPassword: string; tooManyAttempts: string; genericError: string;
};

export function AccessForm({
  slug, galleryTitle, hasPassword, design, coverUrl, labels,
}: {
  slug: string; galleryTitle: string; hasPassword: boolean;
  design: GalleryDesign; coverUrl: string | null; labels: Labels;
}) {
  const pt = PALETTE_TOKENS[design.palette];
  const ft = FONT_TOKENS[design.fontSet];
  const action = enterGalleryAction.bind(null, slug);
  const [state, formAction, pending] = useActionState<EnterState, FormData>(action, null);

  const input =
    "w-full border-0 border-b bg-transparent px-1 py-2 text-sm outline-none focus:border-current";

  return (
    <main
      className={`relative flex min-h-screen items-center justify-center overflow-hidden p-6 ${fontVariables}`}
      style={{ background: pt.bg, color: pt.text, fontFamily: ft.body }}
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
        style={{ background: coverUrl ? "rgba(255,255,255,.92)" : pt.surface, color: coverUrl ? "#1f1f1f" : pt.text }}
      >
        <p className="text-xs" style={{ color: pt.accent, letterSpacing: "0.25em", textTransform: "uppercase" }}>
          {labels.welcome}
        </p>
        <h1
          className="text-3xl leading-snug"
          style={{ fontFamily: ft.display, fontWeight: ft.displayWeight, fontStyle: ft.displayStyle,
            textTransform: ft.displayTransform, letterSpacing: ft.displayTracking }}
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
          className="w-full rounded-full py-2.5 text-sm transition-opacity disabled:opacity-50"
          style={{ background: pt.dark ? pt.accent : "#1a1a1a", color: pt.dark ? "#0e0e10" : "#fff" }}
        >
          {labels.enter}
        </button>
      </motion.form>
    </main>
  );
}
