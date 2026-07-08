import type { GalleryTemplate } from "@/db/schema";

export type TemplateTokens = {
  bg: string; text: string; muted: string; accent: string; surface: string;
  display: string; body: string;               // valores font-family CSS
  displayWeight: number; displayStyle: "normal" | "italic";
  displayTransform: "uppercase" | "none"; displayTracking: string;
  photoRadius: string; photoFrame: boolean;    // frame = marco blanco + sombra (clasico)
  cover: "full" | "lowline" | "warm" | "split";
  dark: boolean;
};

export const TEMPLATE_TOKENS: Record<GalleryTemplate, TemplateTokens> = {
  editorial: {
    bg: "#ffffff", text: "#1a1a1a", muted: "#8a8a8a", accent: "#1a1a1a", surface: "#ffffff",
    display: "var(--font-cormorant), Georgia, serif", body: "var(--font-inter), sans-serif",
    displayWeight: 300, displayStyle: "normal", displayTransform: "uppercase", displayTracking: "0.18em",
    photoRadius: "0px", photoFrame: false, cover: "full", dark: false,
  },
  cinematico: {
    bg: "#0e0e10", text: "#f4f1ea", muted: "#9c968a", accent: "#c8a96a", surface: "#17171a",
    display: "var(--font-playfair), Georgia, serif", body: "var(--font-inter), sans-serif",
    displayWeight: 500, displayStyle: "italic", displayTransform: "none", displayTracking: "0.02em",
    photoRadius: "2px", photoFrame: false, cover: "lowline", dark: true,
  },
  luminoso: {
    bg: "#fdf9f4", text: "#5b4a3f", muted: "#a08d7f", accent: "#c98d6b", surface: "#ffffff",
    display: "var(--font-nunito), sans-serif", body: "var(--font-nunito), sans-serif",
    displayWeight: 700, displayStyle: "normal", displayTransform: "none", displayTracking: "0.01em",
    photoRadius: "16px", photoFrame: false, cover: "warm", dark: false,
  },
  clasico: {
    bg: "#faf7f2", text: "#2b2b2b", muted: "#8a8a8a", accent: "#b59a68", surface: "#ffffff",
    display: "var(--font-garamond), Georgia, serif", body: "var(--font-lato), sans-serif",
    displayWeight: 400, displayStyle: "normal", displayTransform: "none", displayTracking: "0.06em",
    photoRadius: "0px", photoFrame: true, cover: "split", dark: false,
  },
};
