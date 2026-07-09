"use client";

import { motion, useReducedMotion } from "motion/react";
import { GRID_TOKENS, PHOTO_RADIUS, type GalleryDesign } from "./design-options";
import { aspectRatio, flexProps } from "./gallery-layout";
import { IconHeart, IconComment } from "./icons";
import type { ClientPhoto } from "./client-gallery";

export function PhotoGrid({
  design, photos, onOpen, onToggleLike, likeLabel, unlikeLabel,
  previewMode = false, previewOnlyLabel,
}: {
  design: GalleryDesign; photos: ClientPhoto[];
  onOpen: (p: ClientPhoto) => void; onToggleLike: (p: ClientPhoto) => void;
  likeLabel: string; unlikeLabel: string;
  previewMode?: boolean; previewOnlyLabel?: string;
}) {
  const gt = GRID_TOKENS[design.gridStyle];
  const reduce = useReducedMotion();

  const figure = (p: ClientPhoto, i: number, extraClass: string, style: React.CSSProperties) => (
    <motion.figure
      key={p.id}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      transition={{ duration: 0.5, delay: (i % 6) * 0.05 }}
      className={`group relative cursor-pointer overflow-hidden ${extraClass}`}
      style={{ ...style, borderRadius: PHOTO_RADIUS }}
      onClick={() => onOpen(p)}
    >
      <motion.img layoutId={`photo-${p.id}`} src={p.thumbUrl} alt={p.filename} draggable={false}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
      <button
        aria-label={p.liked ? unlikeLabel : likeLabel}
        onClick={(e) => { e.stopPropagation(); onToggleLike(p); }}
        disabled={previewMode}
        aria-disabled={previewMode}
        title={previewMode ? previewOnlyLabel : undefined}
        className={`absolute right-2 top-2 rounded-full bg-black/35 p-2 text-white backdrop-blur transition-opacity disabled:cursor-not-allowed ${
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

  if (gt.square) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6" style={{ gap: gt.gap }}>
        {photos.map((p, i) => figure(p, i, "aspect-square", {}))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap" style={{ gap: gt.gap }}>
      {photos.map((p, i) => {
        const ar = aspectRatio(p);
        const { flexGrow, flexBasis } = flexProps(ar, gt.targetH);
        return figure(p, i, "", { aspectRatio: String(ar), flexGrow, flexBasis: `${flexBasis}px` });
      })}
      <div style={{ flexGrow: 1e4 }} aria-hidden />
    </div>
  );
}
