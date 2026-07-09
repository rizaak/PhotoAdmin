// Selección de imagen de portada: subida > foto elegida > primera elegible.
// `photos` debe venir YA en el orden visible del cliente (secciones visibles, orden de entrega).
type CoverGallery = { coverImageKey: string | null; coverPhotoId: string | null };
type CoverPhoto = { id: string; published: boolean; status: string };

export function pickCoverSource<P extends CoverPhoto>(
  gallery: CoverGallery, photos: P[],
): { type: "upload"; key: string } | { type: "photo"; photo: P } | null {
  if (gallery.coverImageKey) return { type: "upload", key: gallery.coverImageKey };
  const eligible = photos.filter((p) => p.published && p.status === "ready");
  const chosen = eligible.find((p) => p.id === gallery.coverPhotoId) ?? eligible[0];
  return chosen ? { type: "photo", photo: chosen } : null;
}
