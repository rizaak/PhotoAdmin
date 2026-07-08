import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getGallery } from "@/server/galleries";
import { listSections } from "@/server/sections";
import { listGalleryPhotos } from "@/server/photos";
import { presignDownload } from "@/server/storage";
import { listWatermarks } from "@/server/watermarks";
import {
  updateGalleryAction, addSectionAction, renameSectionAction,
  toggleSectionAction, moveSectionAction, deleteSectionAction, setSectionOverridesAction,
} from "./actions";
import { PhotoUploader } from "./photo-uploader";
import { PhotoManager, type PhotoView } from "./photo-manager";
import { ReprocessPhotos } from "./reprocess-photos";

export default async function GalleryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const studio = await requireStudio();
  const [t, tg, tActivity] = await Promise.all([
    getTranslations("galleryDetail"),
    getTranslations("galleries"),
    getTranslations("activity"),
  ]);

  const gallery = await getGallery(db, studio.id, id).catch(() => null);
  if (!gallery) notFound();
  const sectionList = await listSections(db, studio.id, id);
  const photoRows = await listGalleryPhotos(db, studio.id, id);
  const photoViews: PhotoView[] = await Promise.all(
    photoRows.map(async (p) => ({
      id: p.id,
      filename: p.filename,
      sectionId: p.sectionId,
      published: p.published,
      status: p.status,
      thumbUrl: p.thumbKey ? await presignDownload(p.thumbKey) : null,
      webUrl: p.webKey ? await presignDownload(p.webKey) : null,
    })),
  );
  const tp = await getTranslations("galleryDetail.photos");
  const tu = await getTranslations("galleryDetail.upload");
  const studioMarks = await listWatermarks(db, studio.id);
  const hasWatermarks = !!gallery.watermarkId;
  const pendingReprocess = photoRows
    .filter((p) =>
      p.status === "error" ||
      (p.status === "ready" && (hasWatermarks ? !p.webWmKey : !!p.webWmKey)) ||
      (p.status === "ready" && !p.highKey),
    )
    .map((p) => p.id);
  const tr = await getTranslations("galleryDetail.reprocess");

  const check = "h-4 w-4 accent-neutral-900";
  const input = "rounded border px-3 py-1.5 text-sm";

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">{gallery.title}</h1>
        <p className="text-sm text-neutral-500">
          {t("shareLink")}: <code className="rounded bg-neutral-100 px-1">/g/{gallery.slug}</code>
        </p>
        <Link href={`/admin/galleries/${gallery.id}/activity`} className="text-sm text-neutral-500 hover:underline">
          {tActivity("title")} →
        </Link>
      </div>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-4 font-medium">{t("settings")}</h2>
        {/* key: al guardar, React 19 resetea el form a sus defaultValue; remontarlo
            con datos frescos evita mostrar el estado anterior hasta refrescar */}
        <form
          key={gallery.updatedAt.getTime()}
          action={updateGalleryAction}
          className="grid max-w-2xl grid-cols-2 gap-4 text-sm"
        >
          <input type="hidden" name="galleryId" value={gallery.id} />
          <label className="col-span-2 flex flex-col gap-1">
            {t("title")}
            <input name="title" defaultValue={gallery.title} required className={input} />
          </label>
          <label className="flex flex-col gap-1">
            {t("status")}
            <select name="status" defaultValue={gallery.status} className={input}>
              <option value="draft">{tg("status.draft")}</option>
              <option value="published">{tg("status.published")}</option>
              <option value="archived">{tg("status.archived")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {t("photoOrder")}
            <select name="photoOrder" defaultValue={gallery.photoOrder} className={input}>
              <option value="capture">{t("orders.capture")}</option>
              <option value="filename">{t("orders.filename")}</option>
              <option value="manual">{t("orders.manual")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {t("watermarkMode")}
            <select name="watermarkMode" defaultValue={gallery.watermarkMode} className={input}>
              <option value="none">{t("watermarks.none")}</option>
              <option value="view">{t("watermarks.view")}</option>
              <option value="download">{t("watermarks.download")}</option>
              <option value="both">{t("watermarks.both")}</option>
            </select>
          </label>
          <p className="col-span-2 -mt-2 text-xs text-neutral-500">
            {t("watermarkHint")}{" "}
            <Link href="/admin/settings" className="underline">{t("watermarkHintLink")}</Link>
          </p>
          <label className="flex flex-col gap-1">
            {t("watermark")}
            <select name="watermarkId" defaultValue={gallery.watermarkId ?? ""} className={input}>
              <option value="">{t("watermarkNone")}</option>
              {studioMarks.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.slot + 1}. ${m.type === "text" ? m.text : "PNG"} · ${t(`placements.${m.placement}`)}`}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="col-span-2 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="downloadEnabled" defaultChecked={gallery.downloadEnabled} className={check} />
              {t("downloadEnabled")}
            </label>
            <span className="text-neutral-400">|</span>
            <span>{t("resolutions")}:</span>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="resWebEnabled" defaultChecked={gallery.resWebEnabled} className={check} />
              {t("resWeb")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="resHighEnabled" defaultChecked={gallery.resHighEnabled} className={check} />
              {t("resHigh")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="resOriginalEnabled" defaultChecked={gallery.resOriginalEnabled} className={check} />
              {t("resOriginal")}
            </label>
          </fieldset>
          <label className="flex flex-col gap-1">
            {t("newPassword")}
            <input name="password" type="password" minLength={4} className={input} />
          </label>
          <label className="flex items-center gap-2 self-end">
            <input type="checkbox" name="clearPassword" className={check} />
            {t("clearPassword")}
          </label>
          <button className="col-span-2 justify-self-start rounded bg-neutral-900 px-4 py-1.5 text-white">
            {t("save")}
          </button>
        </form>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-4 font-medium">{t("sections")}</h2>
        <ul className="mb-4 divide-y">
          {sectionList.length === 0 && <li className="py-2 text-sm text-neutral-500">{t("noSections")}</li>}
          {sectionList.map((s, idx) => (
            <li key={`${s.id}-${s.watermarkMode}-${s.downloadEnabled}`} className="flex items-center gap-2 py-2 text-sm">
              <form
                key={`${s.id}-${s.name}`}
                action={renameSectionAction}
                className="flex flex-1 items-center gap-2"
              >
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <input name="name" defaultValue={s.name} required className={`${input} flex-1`} />
                <button className="text-neutral-600 hover:underline">{t("rename")}</button>
              </form>
              {!s.visible && <span className="rounded bg-neutral-200 px-1.5 text-xs">{t("hidden")}</span>}
              <form action={moveSectionAction}>
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <input type="hidden" name="direction" value="up" />
                <button disabled={idx === 0} className="px-1 disabled:opacity-30">↑</button>
              </form>
              <form action={moveSectionAction}>
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <input type="hidden" name="direction" value="down" />
                <button disabled={idx === sectionList.length - 1} className="px-1 disabled:opacity-30">↓</button>
              </form>
              <form action={toggleSectionAction}>
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <input type="hidden" name="visible" value={s.visible ? "false" : "true"} />
                <button className="text-neutral-600 hover:underline">
                  {s.visible ? t("hide") : t("show")}
                </button>
              </form>
              <form action={deleteSectionAction}>
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <button className="text-red-600 hover:underline">{t("delete")}</button>
              </form>
              <form action={setSectionOverridesAction} className="flex items-center gap-1 text-xs">
                <input type="hidden" name="galleryId" value={gallery.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <select name="watermarkMode" defaultValue={s.watermarkMode ?? ""} className="rounded border px-1 py-0.5" title={t("overrides.watermark")}>
                  <option value="">{t("overrides.inherit")}</option>
                  <option value="none">{t("watermarks.none")}</option>
                  <option value="view">{t("watermarks.view")}</option>
                  <option value="download">{t("watermarks.download")}</option>
                  <option value="both">{t("watermarks.both")}</option>
                </select>
                <select name="downloadEnabled" defaultValue={s.downloadEnabled === null ? "" : String(s.downloadEnabled)} className="rounded border px-1 py-0.5" title={t("overrides.download")}>
                  <option value="">{t("overrides.inherit")}</option>
                  <option value="true">{t("overrides.yes")}</option>
                  <option value="false">{t("overrides.no")}</option>
                </select>
                <button className="text-neutral-600 hover:underline">{t("overrides.apply")}</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addSectionAction} className="flex gap-2">
          <input type="hidden" name="galleryId" value={gallery.id} />
          <input name="name" required placeholder={t("sectionName")} className={input} />
          <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">{t("add")}</button>
        </form>
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="mb-4 font-medium">{tp("title")}</h2>
        <div className="mb-4">
          <ReprocessPhotos
            photoIds={pendingReprocess}
            labels={{
              pending: tr.raw("pending") as string, run: tr("run"),
              running: tr.raw("running") as string, done: tr("done"),
              failed: tr.raw("failed") as string,
            }}
          />
        </div>
        <div className="mb-6">
          <PhotoUploader
            galleryId={gallery.id}
            sections={sectionList.map((s) => ({ id: s.id, name: s.name }))}
            labels={{
              hint: tu("hint"), select: tu("select"), target: tu("target"), noSection: tu("noSection"),
              uploading: tu("uploading"), processing: tu("processing"), done: tu("done"), error: tu("error"),
            }}
          />
        </div>
        <PhotoManager
          galleryId={gallery.id}
          photos={photoViews}
          sections={sectionList.map((s) => ({ id: s.id, name: s.name }))}
          coverPhotoId={gallery.coverPhotoId}
          labels={{
            // selected/deleteConfirm son plantillas con {count} que el cliente
            // interpola; tp() validaría las variables ICU y fallaría sin count.
            empty: tp("empty"), noSection: tp("noSection"), selected: tp.raw("selected") as string,
            moveTo: tp("moveTo"), move: tp("move"), publish: tp("publish"), hide: tp("hide"),
            delete: tp("delete"), deleteConfirm: tp.raw("deleteConfirm") as string, setCover: tp("setCover"),
            hiddenBadge: tp("hiddenBadge"), processingBadge: tp("processingBadge"),
            errorBadge: tp("errorBadge"), clear: tp("clear"), actionError: tp("actionError"),
            wmApply: tp("wmApply"), wmRemove: tp("wmRemove"), wmInherit: tp("wmInherit"),
          }}
        />
      </section>
    </div>
  );
}
