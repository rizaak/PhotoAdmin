"use client";

import { motion, useReducedMotion } from "motion/react";
import { PALETTE_TOKENS, FONT_TOKENS, type GalleryDesign } from "./design-options";
import { IconChevronDown } from "./icons";

export function GalleryCover({
  design, title, coverUrl, focalX, focalY,
}: {
  design: GalleryDesign; title: string; coverUrl: string | null;
  focalX: number; focalY: number;
}) {
  const pt = PALETTE_TOKENS[design.palette];
  const ft = FONT_TOKENS[design.fontSet];
  const style = design.coverStyle;
  const reduce = useReducedMotion();
  const fade = reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9 } };
  const titleStyle = {
    fontFamily: ft.display, fontWeight: ft.displayWeight, fontStyle: ft.displayStyle,
    textTransform: ft.displayTransform, letterSpacing: ft.displayTracking,
  } as const;
  const img = coverUrl && (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={coverUrl} alt="" draggable={false}
      className="absolute inset-0 h-full w-full object-cover"
      style={{ objectPosition: `${focalX * 100}% ${focalY * 100}%` }} />
  );

  if (style === "split") {
    return (
      <header className="grid min-h-[70vh] md:grid-cols-2" style={{ background: pt.bg }}>
        <motion.div {...fade} className="flex flex-col items-center justify-center p-10 text-center">
          <h1 className="text-4xl md:text-5xl" style={{ ...titleStyle, color: pt.text }}>{title}</h1>
          <div className="mt-6 h-px w-14" style={{ background: pt.accent }} />
        </motion.div>
        <div className="relative min-h-[40vh]">{img}</div>
      </header>
    );
  }

  if (style === "banner") {
    return (
      <header style={{ background: pt.bg }}>
        <div className="relative h-[50vh] min-h-56 overflow-hidden">{img}</div>
        <motion.div {...fade} className="flex flex-col items-center px-8 py-10 text-center">
          <h1 className="text-4xl md:text-5xl" style={{ ...titleStyle, color: pt.text }}>{title}</h1>
          <div className="mt-5 h-px w-14" style={{ background: pt.accent }} />
        </motion.div>
      </header>
    );
  }

  // "overlay" (unifica los antiguos lowline/warm): degradado hacia pt.bg, título abajo-izquierda.
  const overlay = style === "full"
    ? "linear-gradient(to top, rgba(0,0,0,.45), rgba(0,0,0,.12))"
    : `linear-gradient(to top, ${pt.bg} 4%, transparent 55%)`;

  return (
    <header className={`relative overflow-hidden ${style === "full" ? "h-screen" : "h-[78vh]"} min-h-72`}>
      {img}
      <div className="absolute inset-0" style={{ background: overlay }} />
      <motion.div
        {...fade}
        className={`absolute inset-0 flex flex-col p-8 md:p-12 ${
          style === "full" ? "items-center justify-center" : "items-start justify-end"
        }`}
      >
        <h1 className="text-4xl md:text-6xl" style={{ ...titleStyle, color: style === "full" ? "#fff" : pt.text }}>
          {title}
        </h1>
        {style !== "full" && <div className="mt-3 h-px w-16" style={{ background: pt.accent }} />}
        {style === "full" && (
          <motion.span
            className="absolute bottom-8 text-white/80"
            animate={reduce ? undefined : { y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 2.2 }}
          >
            <IconChevronDown className="h-6 w-6" />
          </motion.span>
        )}
      </motion.div>
    </header>
  );
}
