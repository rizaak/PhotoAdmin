"use client";

import { motion, useReducedMotion } from "motion/react";
import type { GalleryTemplate } from "@/db/schema";
import { TEMPLATE_TOKENS } from "./templates";
import { aspectRatio, flexProps } from "./gallery-layout";
import { IconHeart, IconComment } from "./icons";
import type { ClientPhoto } from "./client-gallery";

export function PhotoGrid({
  template, photos, onOpen, onToggleLike, likeLabel, unlikeLabel,
}: {
  template: GalleryTemplate; photos: ClientPhoto[];
  onOpen: (p: ClientPhoto) => void; onToggleLike: (p: ClientPhoto) => void;
  likeLabel: string; unlikeLabel: string;
}) {
  const tk = TEMPLATE_TOKENS[template];
  const reduce = useReducedMotion();
  const frame = tk.photoFrame
    ? { border: "5px solid #ffffff", boxShadow: "0 2px 14px rgba(0,0,0,.14)" } : {};

  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p, i) => {
        const ar = aspectRatio(p);
        const { flexGrow, flexBasis } = flexProps(ar, 280);
        return (
          <motion.figure
            key={p.id}
            initial={reduce ? false : { opacity: 0, y: 24 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -60px 0px" }}
            transition={{ duration: 0.5, delay: (i % 6) * 0.05 }}
            className="group relative cursor-pointer overflow-hidden"
            style={{ aspectRatio: String(ar), flexGrow, flexBasis: `${flexBasis}px`,
              borderRadius: tk.photoRadius, ...frame }}
            onClick={() => onOpen(p)}
          >
            <motion.img layoutId={`photo-${p.id}`} src={p.thumbUrl} alt={p.filename} draggable={false}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
            <button
              aria-label={p.liked ? unlikeLabel : likeLabel}
              onClick={(e) => { e.stopPropagation(); onToggleLike(p); }}
              className={`absolute right-2 top-2 rounded-full bg-black/35 p-2 text-white backdrop-blur transition-opacity ${
                p.liked ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              }`}
            >
              <IconHeart filled={p.liked} className={`h-4 w-4 ${p.liked ? "text-red-400" : ""}`} />
            </button>
            {p.comment && (
              <span className="absolute bottom-2 right-2 rounded-full bg-black/35 p-1.5 text-white backdrop-blur">
                <IconComment className="h-3.5 w-3.5" />
              </span>
            )}
          </motion.figure>
        );
      })}
      <div style={{ flexGrow: 1e4 }} aria-hidden />
    </div>
  );
}
