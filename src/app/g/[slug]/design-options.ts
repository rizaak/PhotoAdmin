import type { CoverStyle, FontSet, Palette, GridStyle } from "@/db/schema";

export type GalleryDesign = { coverStyle: CoverStyle; fontSet: FontSet; palette: Palette; gridStyle: GridStyle };

export type PaletteTokens = { bg: string; text: string; muted: string; accent: string; surface: string; dark: boolean };
export const PALETTE_TOKENS: Record<Palette, PaletteTokens> = {
  blanco: { bg: "#ffffff", text: "#1a1a1a", muted: "#8a8a8a", accent: "#1a1a1a", surface: "#ffffff", dark: false },
  marfil: { bg: "#faf7f2", text: "#2b2b2b", muted: "#8a8a8a", accent: "#b59a68", surface: "#ffffff", dark: false },
  calido: { bg: "#fdf9f4", text: "#5b4a3f", muted: "#a08d7f", accent: "#c98d6b", surface: "#ffffff", dark: false },
  carbon: { bg: "#0e0e10", text: "#f4f1ea", muted: "#9c968a", accent: "#c8a96a", surface: "#17171a", dark: true },
  noche: { bg: "#12151c", text: "#e8ebf2", muted: "#8d97a8", accent: "#aab4c4", surface: "#1a1e27", dark: true },
};

export type FontTokens = {
  display: string; body: string; displayWeight: number;
  displayStyle: "normal" | "italic"; displayTransform: "uppercase" | "none"; displayTracking: string;
};
export const FONT_TOKENS: Record<FontSet, FontTokens> = {
  elegante: { display: "var(--font-cormorant), Georgia, serif", body: "var(--font-inter), sans-serif",
    displayWeight: 300, displayStyle: "normal", displayTransform: "uppercase", displayTracking: "0.18em" },
  dramatica: { display: "var(--font-playfair), Georgia, serif", body: "var(--font-inter), sans-serif",
    displayWeight: 500, displayStyle: "italic", displayTransform: "none", displayTracking: "0.02em" },
  amable: { display: "var(--font-nunito), sans-serif", body: "var(--font-nunito), sans-serif",
    displayWeight: 700, displayStyle: "normal", displayTransform: "none", displayTracking: "0.01em" },
  clasica: { display: "var(--font-garamond), Georgia, serif", body: "var(--font-lato), sans-serif",
    displayWeight: 400, displayStyle: "normal", displayTransform: "none", displayTracking: "0.06em" },
};

export const GRID_TOKENS: Record<GridStyle, { targetH: number; gap: number; square: boolean }> = {
  justificada: { targetH: 220, gap: 6, square: false },
  aireada: { targetH: 280, gap: 18, square: false },
  cuadrada: { targetH: 0, gap: 6, square: true },
};

export const PHOTO_RADIUS = "2px";
