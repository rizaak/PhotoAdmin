import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { getClientGalleryData, getPublicGallery } from "@/server/client-access";
import { getOptionalClientSession } from "@/server/client-auth";
import { presignDownload } from "@/server/storage";
import { AccessForm } from "./access-form";
import { ClientGallery } from "./client-gallery";

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
    return (
      <AccessForm
        slug={slug}
        galleryTitle={gallery.title}
        hasPassword={gallery.passwordHash !== null}
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
  const photoViews = await Promise.all(
    data.photos.map(async (p) => ({
      id: p.id,
      filename: p.filename,
      sectionId: p.sectionId,
      thumbUrl: p.thumbKey ? await presignDownload(p.thumbKey) : "",
      webUrl: p.webKey ? await presignDownload(p.webKey) : "",
      liked: data.likedPhotoIds.includes(p.id),
      comments: (data.commentsByPhoto[p.id] ?? []).map((c) => ({ id: c.id, body: c.body })),
    })),
  );
  const cover = data.photos.find((p) => p.id === data.gallery.coverPhotoId);
  const coverUrl = cover?.webKey ? await presignDownload(cover.webKey) : null;
  const sectionBlocks: { id: string | null; name: string | null }[] = [
    { id: null, name: null },
    ...data.sections.map((s) => ({ id: s.id, name: s.name })),
  ];

  return (
    <ClientGallery
      slug={slug}
      title={data.gallery.title}
      theme={data.gallery.theme}
      coverUrl={coverUrl}
      coverFocalX={data.gallery.coverFocalX}
      coverFocalY={data.gallery.coverFocalY}
      sections={sectionBlocks}
      photos={photoViews.filter((p) => p.thumbUrl && p.webUrl)}
      labels={{
        like: t("like"), unlike: t("unlike"), comments: t("comments"),
        commentPlaceholder: t("commentPlaceholder"), send: t("send"),
        empty: t("empty"), yourActivity: t("yourActivity"),
      }}
    />
  );
}
