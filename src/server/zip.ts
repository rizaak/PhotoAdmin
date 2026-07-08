import { SignJWT } from "jose";

export function buildZipManifest(input: {
  zipName: string;
  entries: { key: string; name: string }[];
}): { zipName: string; files: { key: string; name: string }[] } {
  if (input.entries.length === 0) throw new Error("NOTHING_TO_DOWNLOAD");
  const used = new Map<string, number>();
  const files = input.entries.map((e) => {
    const count = used.get(e.name) ?? 0;
    used.set(e.name, count + 1);
    if (count === 0) return { key: e.key, name: e.name };
    const stem = e.name.replace(/\.[^.]+$/, "");
    const ext = e.name.slice(stem.length);
    return { key: e.key, name: `${stem} (${count})${ext}` };
  });
  return { zipName: input.zipName, files };
}

export async function signZipToken(manifestKey: string): Promise<string> {
  const secret = process.env.ZIP_SIGNING_SECRET;
  if (!secret) throw new Error("ZIP_NOT_CONFIGURED");
  return new SignJWT({ m: manifestKey })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));
}
