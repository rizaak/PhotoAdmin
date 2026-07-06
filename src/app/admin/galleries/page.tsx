import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { listGalleries } from "@/server/galleries";
import type { GalleryStatus } from "@/db/schema";
import { createGalleryAction } from "./actions";
import { DeleteGalleryForm } from "./delete-gallery-form";

const STATUSES: GalleryStatus[] = ["draft", "published", "archived"];

export default async function GalleriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const [studio, t, params] = await Promise.all([
    requireStudio(),
    getTranslations("galleries"),
    searchParams,
  ]);
  const status = STATUSES.includes(params.status as GalleryStatus)
    ? (params.status as GalleryStatus)
    : undefined;
  const items = await listGalleries(db, studio.id, { search: params.q, status });

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <form method="GET" className="flex gap-2">
        <input
          name="q" defaultValue={params.q ?? ""} placeholder={t("searchPlaceholder")}
          className="w-64 rounded border px-3 py-1.5 text-sm"
        />
        <select name="status" defaultValue={params.status ?? ""} className="rounded border px-2 py-1.5 text-sm">
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
        <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">{t("filter")}</button>
      </form>

      <ul className="divide-y rounded border bg-white">
        {items.length === 0 && <li className="p-4 text-sm text-neutral-500">{t("empty")}</li>}
        {items.map((g) => (
          <li key={g.id} className="flex items-center justify-between p-4">
            <div>
              <Link href={`/admin/galleries/${g.id}`} className="font-medium hover:underline">
                {g.title}
              </Link>
              <p className="text-xs text-neutral-500">
                {t(`status.${g.status}`)} · {t("created")} {g.createdAt.toISOString().slice(0, 10)}
              </p>
            </div>
            <DeleteGalleryForm
              galleryId={g.id}
              label={t("delete")}
              confirmMessage={t("deleteConfirm")}
            />
          </li>
        ))}
      </ul>

      <form action={createGalleryAction} className="flex max-w-md flex-col gap-2 rounded border bg-white p-4">
        <h2 className="font-medium">{t("newGallery")}</h2>
        <input name="title" required placeholder={t("galleryTitle")} className="rounded border px-3 py-1.5 text-sm" />
        <button className="self-start rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">{t("create")}</button>
      </form>
    </div>
  );
}
