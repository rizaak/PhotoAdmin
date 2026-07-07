import { SignJWT, jwtVerify } from "jose";

export const CLIENT_COOKIE = "client_session";

export type ClientSession = { clientId: string; galleryId: string };

function secret(): Uint8Array {
  const value = process.env.CLIENT_SESSION_SECRET;
  if (!value) throw new Error("Missing env var CLIENT_SESSION_SECRET");
  return new TextEncoder().encode(value);
}

export async function signClientSession(payload: ClientSession): Promise<string> {
  return new SignJWT({ clientId: payload.clientId, galleryId: payload.galleryId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifyClientSession(token: string): Promise<ClientSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.clientId !== "string" || typeof payload.galleryId !== "string") return null;
    return { clientId: payload.clientId, galleryId: payload.galleryId };
  } catch {
    return null;
  }
}

export function clientCookieOptions(slug: string) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: `/g/${slug}`,
    maxAge: 60 * 60 * 24 * 30,
  };
}
