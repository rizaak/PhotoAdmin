import { jwtVerify } from "jose";

export interface Env {
  BUCKET: R2Bucket;
  ZIP_SIGNING_SECRET: string;
}

type ManifestFile = { key: string; name: string };
type Manifest = { zipName: string; files: ManifestFile[] };

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32Update(crc: number, chunk: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

// ---------- little-endian ----------
function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function u64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}
function bytes(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

const FLAGS = 0x0808; // bit 3 (data descriptor) + bit 11 (UTF-8)
const DOS_TIME = 0;
const DOS_DATE = 0x5821; // 2024-01-01, valor fijo inofensivo

type CentralEntry = { nameBytes: Uint8Array; crc: number; size: number; offset: number };

async function streamZip(env: Env, manifest: Manifest, writer: WritableStreamDefaultWriter<Uint8Array>) {
  const encoder = new TextEncoder();
  const central: CentralEntry[] = [];
  let offset = 0;

  const write = async (chunk: Uint8Array) => {
    await writer.write(chunk);
    offset += chunk.length;
  };

  for (const file of manifest.files) {
    const object = await env.BUCKET.get(file.key);
    if (!object) continue; // objeto borrado entre firma y descarga: se omite
    const nameBytes = encoder.encode(file.name);
    const entryOffset = offset;

    await write(bytes(
      u32(0x04034b50), u16(20), u16(FLAGS), u16(0), // método store
      u16(DOS_TIME), u16(DOS_DATE), u32(0), u32(0), u32(0), // crc/sizes en descriptor
      u16(nameBytes.length), u16(0), nameBytes,
    ));

    let crc = 0xffffffff;
    let size = 0;
    const reader = object.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      crc = crc32Update(crc, value);
      size += value.length;
      await write(value);
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    // data descriptor (32 bits: cada entrada ≤100MB)
    await write(bytes(u32(0x08074b50), u32(crc), u32(size), u32(size)));
    central.push({ nameBytes, crc, size, offset: entryOffset });
  }

  const cdStart = offset;
  for (const e of central) {
    // zip64 extra: usize, csize, offset (los 3 campos de 8 bytes)
    const extra = bytes(u16(0x0001), u16(24), u64(e.size), u64(e.size), u64(e.offset));
    await write(bytes(
      u32(0x02014b50), u16(45), u16(45), u16(FLAGS), u16(0),
      u16(DOS_TIME), u16(DOS_DATE), u32(e.crc),
      u32(0xffffffff), u32(0xffffffff), // sizes → zip64
      u16(e.nameBytes.length), u16(extra.length), u16(0),
      u16(0), u16(0), u32(0),
      u32(0xffffffff), // offset → zip64
      e.nameBytes, extra,
    ));
  }
  const cdSize = offset - cdStart;

  const eocd64Offset = offset;
  await write(bytes(
    u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
    u64(central.length), u64(central.length), u64(cdSize), u64(cdStart),
  ));
  await write(bytes(u32(0x07064b50), u32(0), u64(eocd64Offset), u32(1)));
  await write(bytes(
    u32(0x06054b50), u16(0), u16(0),
    u16(Math.min(central.length, 0xffff)), u16(Math.min(central.length, 0xffff)),
    u32(0xffffffff), u32(0xffffffff), u16(0),
  ));
  await writer.close();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) return new Response("missing token", { status: 401 });

    let manifestKey: string;
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.ZIP_SIGNING_SECRET));
      if (typeof payload.m !== "string") throw new Error("bad payload");
      manifestKey = payload.m;
    } catch {
      return new Response("invalid token", { status: 401 });
    }

    const manifestObject = await env.BUCKET.get(manifestKey);
    if (!manifestObject) return new Response("manifest not found", { status: 404 });
    const manifest = (await manifestObject.json()) as Manifest;

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    ctx.waitUntil(
      streamZip(env, manifest, writer).catch(async (e) => {
        console.error("zip stream failed", e);
        await writer.abort(e).catch(() => {});
      }),
    );

    const safeName = manifest.zipName.replace(/[^\x20-\x7e]|"/g, "_");
    return new Response(readable, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  },
};
