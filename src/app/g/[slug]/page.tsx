import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/db";
import { getPublicGallery } from "@/server/client-access";
import { getOptionalClientSession } from "@/server/client-auth";
import { AccessForm } from "./access-form";

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

  // Task 9 reemplaza este placeholder por la galería completa
  return <main className="p-8">{session.gallery.title}</main>;
}
