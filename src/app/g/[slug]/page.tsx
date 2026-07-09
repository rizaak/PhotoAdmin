import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { getClientGalleryData, getPublicGallery, getVisiblePhotos } from "@/server/client-access";
import { getOptionalClientSession } from "@/server/client-auth";
import { presignDownload } from "@/server/storage";
import { pickCoverSource } from "@/server/cover";
import { clientViewPhotos } from "@/server/delivery";
import { AccessForm } from "./access-form";
import { ClientGallery } from "./client-gallery";
import { buildGalleryProps, toDesign } from "./build-props";

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
    // Portada efectiva: imagen subida (sin gates, no es contenido entregable al cliente)
    // > foto elegida > primera foto elegible, todas pasadas por los mismos gates de
    // visibilidad que el resto de la puerta (published + ready + sección visible).
    let coverUrl: string | null = null;
    const { sections: doorSections, photos: doorPhotos } = await getVisiblePhotos(db, gallery);
    const doorSource = pickCoverSource(gallery, doorPhotos);
    if (doorSource?.type === "upload") {
      coverUrl = await presignDownload(doorSource.key);
    } else if (doorSource?.type === "photo") {
      const doorViewList = clientViewPhotos(
        doorPhotos, doorSections, { watermarkMode: gallery.watermarkMode, hasWatermarks: !!gallery.watermarkId },
      );
      const doorView = doorViewList.find((v) => v.id === doorSource.photo.id) ?? doorViewList[0];
      if (doorView) coverUrl = await presignDownload(doorView.webKey);
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
  const props = await buildGalleryProps(data);

  return (
    <ClientGallery
      slug={slug}
      {...props}
      labels={{
        like: t("like"), unlike: t("unlike"), comments: t("comments"),
        commentPlaceholder: t("commentPlaceholder"), send: t("send"),
        empty: t("empty"), actionError: t("actionError"),
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
