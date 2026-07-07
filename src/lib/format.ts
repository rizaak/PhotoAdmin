const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let i = Math.min(Math.floor(Math.log2(bytes) / 10), UNITS.length - 1);
  let value = bytes / 2 ** (10 * i);
  if (i < UNITS.length - 1 && Number(value.toFixed(1)) >= 1024) {
    i += 1;
    value = bytes / 2 ** (10 * i);
  }
  return `${i === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[i]}`;
}
