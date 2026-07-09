import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { photos, sections, type CoverStyle, type FontSet, type Palette, type GridStyle } from "@/db/schema";
import type { GalleryDesign } from "./design-options";
import { getClientGalleryData, getPublicGallery } from "@/server/client-access";
import { getOptionalClientSession } from "@/server/client-auth";
import { presignDownload } from "@/server/storage";
import {
  clientViewPhotos, effectiveWatermarkMode, effectiveDownloadEnabled, enabledResolutions, downloadKey, viewKeys,
} from "@/server/delivery";
import { AccessForm } from "./access-form";
import { ClientGallery } from "./client-gallery";

function toDesign(g: { coverStyle: string; fontSet: string; palette: string; gridStyle: string }): GalleryDesign {
  return {
    coverStyle: g.coverStyle as CoverStyle, fontSet: g.fontSet as FontSet,
    palette: g.palette as Palette, gridStyle: g.gridStyle as GridStyle,
  };
}

export default async function ClientGalleryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTranslations("clientGallery");

  let session;
  try {
    session = await getOptionalClientSession(slug);
  } catch {
    notFound();
  }

  if (!session) {
    const gallery = await getPublicGallery(db, slug).catch(() => null);
    if (!gallery) notFound();
    let coverUrl: string | null = null;
    if (gallery.coverPhotoId) {
      // Mismos gates de visibilidad que getClientGalleryData: published + ready + sección visible
      const [cover] = await db.select().from(photos)
        .where(and(
          eq(photos.id, gallery.coverPhotoId), eq(photos.galleryId, gallery.id),
          eq(photos.published, true), eq(photos.status, "ready"),
        ));
      const [section] = cover?.sectionId
        ? await db.select().from(sections)
          .where(and(eq(sections.id, cover.sectionId), eq(sections.galleryId, gallery.id)))
        : [];
      if (cover && (!cover.sectionId || section?.visible)) {
        const mode = effectiveWatermarkMode(cover, section ?? null,
          { watermarkMode: gallery.watermarkMode, hasWatermarks: !!gallery.watermarkId });
        const keys = viewKeys(cover, mode);
        if (keys) coverUrl = await presignDownload(keys.webKey);
      }
    }
    return (
      <AccessForm
        slug={slug}
        galleryTitle={gallery.title}
        hasPassword={gallery.passwordHash !== null}
        design={toDesign(gallery)}
        coverUrl={coverUrl}
        labels={{
          welcome: t("welcome"), emailLabel: t("emailLabel"), nameLabel: t("nameLabel"),
          passwordLabel: t("passwordLabel"), enter: t("enter"),
          invalidPassword: t("invalidPassword"), tooManyAttempts: t("tooManyAttempts"),
          genericError: t("genericError"),
        }}
      />
    );
  }

  const data = await getClientGalleryData(db, session.gallery.id, session.clientId);
  const hasWatermarks = !!data.gallery.watermarkId;
  const watermarkGallery = { watermarkMode: data.gallery.watermarkMode, hasWatermarks };
  const viewList = clientViewPhotos(data.photos, data.sections, watermarkGallery);
  const byId = new Map(data.photos.map((p) => [p.id, p]));
  const sectionById = new Map(data.sections.map((s) => [s.id, s]));
  const resolutions = enabledResolutions(data.gallery);
  const photoViews = await Promise.all(
    viewList.map(async (v) => {
      const p = byId.get(v.id)!;
      const section = p.sectionId ? sectionById.get(p.sectionId) ?? null : null;
      const mode = effectiveWatermarkMode(p, section, watermarkGallery);
      const downloads = effectiveDownloadEnabled(section, data.gallery)
        ? resolutions.filter((r) => downloadKey(p, mode, r) !== null)
        : [];
      return {
        id: p.id,
        filename: p.filename,
        sectionId: v.sectionId,
        thumbUrl: await presignDownload(v.thumbKey),
        webUrl: await presignDownload(v.webKey),
        width: p.width,
        height: p.height,
        liked: data.likedPhotoIds.includes(p.id),
        comment: data.commentsByPhoto[p.id]?.[0]
          ? { id: data.commentsByPhoto[p.id][0].id, body: data.commentsByPhoto[p.id][0].body }
          : null,
        downloads,
      };
    }),
  );
  const cover = viewList.find((v) => v.id === data.gallery.coverPhotoId);
  const coverUrl = cover ? await presignDownload(cover.webKey) : null;
  const sectionBlocks = data.sections.map((s) => ({ id: s.id, name: s.name }));
  const zip = {
    enabled: photoViews.some((p) => p.downloads.length > 0),
    resolutions: enabledResolutions(data.gallery),
  };

  return (
    <ClientGallery
      slug={slug}
      title={data.gallery.title}
      design={toDesign(data.gallery)}
      coverUrl={coverUrl}
      coverFocalX={data.gallery.coverFocalX}
      coverFocalY={data.gallery.coverFocalY}
      sections={sectionBlocks}
      photos={photoViews}
      zip={zip}
      labels={{
        like: t("like"), unlike: t("unlike"), comments: t("comments"),
        commentPlaceholder: t("commentPlaceholder"), send: t("send"),
        empty: t("empty"), yourActivity: t("yourActivity"), actionError: t("actionError"),
        download: t("download"),
        resolutions: { web: t("resolutions.web"), high: t("resolutions.high"), original: t("resolutions.original") },
        favorites: t("favorites"), noFavorites: t("noFavorites"),
        downloadGallery: t("downloadGallery"), downloadFavorites: t("downloadFavorites"),
        downloadSection: t("downloadSection"), zipError: t("zipError"), zipUnavailable: t("zipUnavailable"),
        close: t("close"), prev: t("prev"), next: t("next"),
      }}
    />
  );
}
