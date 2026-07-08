import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireStudio } from "@/server/auth";
import { presignUpload } from "@/server/storage";

const bodySchema = z.object({
  filename: z.string().min(1).max(200),
  size: z.number().int().positive().max(5 * 1024 * 1024),
  contentType: z.literal("image/png"),
});

export async function POST(request: Request) {
  let studioId: string;
  try {
    studioId = (await requireStudio()).id;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const key = `studios/${studioId}/watermarks/${randomUUID()}.png`;
  const uploadUrl = await presignUpload(key, "image/png", 600, parsed.data.size);
  return NextResponse.json({ uploadUrl, key });
}
