// Iconos de línea compartidos (stroke 1.5). Sin emojis en la UI del cliente.
const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.5,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const IconHeart = ({ filled = false, className = "" }: { filled?: boolean; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base} fill={filled ? "currentColor" : "none"}>
    <path d="M12 20.5C7 16.5 3.5 13.3 3.5 9.6 3.5 7 5.5 5 8 5c1.6 0 3.1.8 4 2.1C12.9 5.8 14.4 5 16 5c2.5 0 4.5 2 4.5 4.6 0 3.7-3.5 6.9-8.5 10.9z" />
  </svg>
);
export const IconComment = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}>
    <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
  </svg>
);
export const IconDownload = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" /></svg>
);
export const IconClose = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconPrev = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M15 5l-7 7 7 7" /></svg>
);
export const IconNext = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M9 5l7 7-7 7" /></svg>
);
export const IconChevronDown = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}><path d="M6 9l6 6 6-6" /></svg>
);
