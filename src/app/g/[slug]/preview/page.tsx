import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { requireStudio } from "@/server/auth";
import { getPreviewGalleryData } from "@/server/client-access";
import { buildGalleryProps } from "../build-props";
import { ClientGallery } from "../client-gallery";

// Vista previa para el fotógrafo: exige sesión de estudio + que la galería sea suya
// (404 si no) y NUNCA toca la sesión/cookie de cliente. Usa los MISMOS gates de
// getVisiblePhotos que la vista de cliente (getPreviewGalleryData), así que no puede
// mostrar más de lo que vería un cliente real por esos mismos filtros — la única
// diferencia es que no exige status "published" y likes/comentarios van vacíos.
export default async function GalleryPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const studio = await requireStudio();
  const data = await getPreviewGalleryData(db, studio.id, slug).catch(() => null);
  if (!data) notFound();
  const t = await getTranslations("clientGallery");
  const props = await buildGalleryProps(data);
  return (
    <ClientGallery
      slug={slug}
      {...props}
      previewMode
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
        previewBanner: t("previewBanner"), previewOnly: t("previewOnly"),
      }}
    />
  );
}
