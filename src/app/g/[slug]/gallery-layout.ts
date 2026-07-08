// Grid de filas justificadas sin librería: cada figura recibe
// flex-grow ∝ aspect-ratio y flex-basis = ar × altura objetivo;
// el CSS (aspect-ratio + flex-wrap + spacer final) hace el resto.
export function aspectRatio(p: { width: number | null; height: number | null }): number {
  if (!p.width || !p.height || p.width <= 0 || p.height <= 0) return 1.5; // fallback 3:2
  return p.width / p.height;
}

export function flexProps(ar: number, targetH: number): { flexGrow: number; flexBasis: number } {
  return { flexGrow: ar * 100, flexBasis: Math.round(ar * targetH) };
}
