import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getGallery } from "@/server/galleries";
import {
  listGalleryClients, clientEngagementDetail, clientActivityLog,
} from "@/server/activity";
import { presignDownload } from "@/server/storage";
import { SelectionForm } from "./selection-form";

export default async function ActivityPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ client?: string }>;
}) {
  const [{ id }, { client: selectedClient }] = await Promise.all([params, searchParams]);
  const studio = await requireStudio();
  const t = await getTranslations("activity");

  const gallery = await getGallery(db, studio.id, id).catch(() => null);
  if (!gallery) notFound();
  const clientRows = await listGalleryClients(db, studio.id, id);

  const detail = selectedClient
    ? await clientEngagementDetail(db, studio.id, id, selectedClient).catch(() => null)
    : null;
  const log = selectedClient
    ? await clientActivityLog(db, studio.id, id, selectedClient).catch(() => [])
    : [];
  const likedThumbs = detail
    ? await Promise.all(detail.likedPhotos.map(async (p) => ({
        id: p.id, filename: p.filename,
        thumbUrl: p.thumbKey ? await presignDownload(p.thumbKey) : null,
      })))
    : [];
  const selected = clientRows.find((c) => c.clientId === selectedClient);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")} · {gallery.title}</h1>
        <Link href={`/admin/galleries/${id}`} className="text-sm text-neutral-500 hover:underline">
          ← {t("backToGallery")}
        </Link>
      </div>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-3 font-medium">{t("clients")}</h2>
        {clientRows.length === 0 && <p className="text-sm text-neutral-500">{t("noClients")}</p>}
        <ul className="divide-y text-sm">
          {clientRows.map((c) => (
            <li key={c.clientId} className="flex items-center justify-between py-2">
              <Link
                href={`/admin/galleries/${id}/activity?client=${c.clientId}`}
                className={`hover:underline ${c.clientId === selectedClient ? "font-semibold" : ""}`}
              >
                {c.email}{c.name ? ` (${c.name})` : ""}
              </Link>
              <span className="text-xs text-neutral-500">
                ♥ {c.likeCount} · 💬 {c.commentCount} · {t("lastSeen")}:{" "}
                {c.lastSeenAt ? c.lastSeenAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {clientRows.length > 0 && (
        <SelectionForm
          galleryId={id}
          clients={clientRows.map((c) => ({ clientId: c.clientId, email: c.email }))}
          labels={{
            createSection: t("createSection"), sectionName: t("sectionName"),
            selectClients: t("selectClients"), hideOthers: t("hideOthers"),
            create: t("create"), created: t.raw("created") as string,
            emptySelection: t("emptySelection"), selectAtLeastOne: t("selectAtLeastOne"),
          }}
        />
      )}

      {detail && selected && (
        <>
          <section className="rounded border bg-white p-4">
            <h2 className="mb-3 font-medium">{t("favoritesOf")} {selected.email}</h2>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
              {likedThumbs.map((p) => p.thumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={p.thumbUrl} alt={p.filename} className="aspect-square w-full rounded object-cover" />
              ))}
            </div>
          </section>
          <section className="rounded border bg-white p-4">
            <h2 className="mb-3 font-medium">{t("commentsOf")} {selected.email}</h2>
            <ul className="space-y-2 text-sm">
              {detail.comments.map((c) => (
                <li key={c.id} className="rounded bg-neutral-50 p-2">
                  <span className="text-xs text-neutral-500">{c.photo.filename}: </span>{c.body}
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded border bg-white p-4">
            <h2 className="mb-3 font-medium">{t("log")}</h2>
            <ul className="space-y-1 text-sm">
              {log.map((e, i) => (
                <li key={i} className="flex justify-between">
                  <span>{t(`event.${e.type}`)}{e.photoFilename ? ` · ${e.photoFilename}` : ""}</span>
                  <span className="text-xs text-neutral-500">{e.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
