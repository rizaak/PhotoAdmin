"use client";

import { motion, useReducedMotion } from "motion/react";
import type { GalleryTemplate } from "@/db/schema";
import { TEMPLATE_TOKENS } from "./templates";
import { IconChevronDown } from "./icons";

export function GalleryCover({
  template, title, coverUrl, focalX, focalY,
}: {
  template: GalleryTemplate; title: string; coverUrl: string | null;
  focalX: number; focalY: number;
}) {
  const tk = TEMPLATE_TOKENS[template];
  const reduce = useReducedMotion();
  const fade = reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9 } };
  const titleStyle = {
    fontFamily: tk.display, fontWeight: tk.displayWeight, fontStyle: tk.displayStyle,
    textTransform: tk.displayTransform, letterSpacing: tk.displayTracking,
  } as const;
  const img = coverUrl && (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={coverUrl} alt="" draggable={false}
      className="absolute inset-0 h-full w-full object-cover"
      style={{ objectPosition: `${focalX * 100}% ${focalY * 100}%` }} />
  );

  if (tk.cover === "split") {
    return (
      <header className="grid min-h-[70vh] md:grid-cols-2" style={{ background: tk.bg }}>
        <motion.div {...fade} className="flex flex-col items-center justify-center p-10 text-center">
          <h1 className="text-4xl md:text-5xl" style={titleStyle}>{title}</h1>
          <div className="mt-6 h-px w-14" style={{ background: tk.accent }} />
        </motion.div>
        <div className="relative min-h-[40vh]">{img}</div>
      </header>
    );
  }

  const overlay =
    tk.cover === "lowline" ? `linear-gradient(to top, ${tk.bg} 4%, transparent 55%)`
    : tk.cover === "warm" ? `linear-gradient(to top, ${tk.bg} 2%, transparent 45%)`
    : "linear-gradient(to top, rgba(0,0,0,.45), rgba(0,0,0,.12))";

  return (
    <header className={`relative overflow-hidden ${tk.cover === "full" ? "h-screen" : "h-[78vh]"} min-h-72`}>
      {img}
      <div className="absolute inset-0" style={{ background: overlay }} />
      <motion.div
        {...fade}
        className={`absolute inset-0 flex flex-col p-8 md:p-12 ${
          tk.cover === "lowline" ? "items-start justify-end" : "items-center " + (tk.cover === "warm" ? "justify-end pb-16" : "justify-center")
        }`}
      >
        <h1 className="text-4xl md:text-6xl" style={{ ...titleStyle, color: tk.cover === "full" ? "#fff" : tk.text }}>
          {title}
        </h1>
        {tk.cover === "lowline" && <div className="mt-3 h-px w-16" style={{ background: tk.accent }} />}
        {tk.cover === "full" && (
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
