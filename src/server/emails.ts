import { Resend } from "resend";

export function firstAccessEmail(galleryTitle: string, clientEmail: string) {
  return {
    subject: `Nuevo acceso a "${galleryTitle}"`,
    text: `${clientEmail} entró por primera vez a la galería "${galleryTitle}".`,
  };
}

export function commentEmail(galleryTitle: string, clientEmail: string, commentBody: string, photoFilename: string) {
  return {
    subject: `Nuevo comentario en "${galleryTitle}"`,
    text: `${clientEmail} comentó la foto ${photoFilename} de "${galleryTitle}":\n\n"${commentBody}"`,
  };
}

export async function notifyPhotographer(input: { to: string | null; subject: string; text: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !input.to) {
    console.log("email skipped (sin RESEND_API_KEY o destinatario):", input.subject);
    return;
  }
  try {
    await new Resend(key).emails.send({
      from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
  } catch (e) {
    console.error("email send failed:", input.subject, e);
  }
}
