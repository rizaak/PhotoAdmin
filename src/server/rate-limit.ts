// Ventana deslizante en memoria. En serverless es por instancia: suficiente
// como fricción anti fuerza bruta v1; endurecer con storage compartido si escala.
const attempts = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  max = 10,
  windowMs = 15 * 60 * 1000
): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    attempts.set(key, recent);
    return false;
  }
  recent.push(now);
  attempts.set(key, recent);
  return true;
}

export function resetRateLimit(): void {
  attempts.clear();
}
