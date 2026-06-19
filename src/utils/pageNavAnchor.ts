// Navigatsiooni-ankur: positsioneeri end failinime, mitte jäiga indeksi järgi
// (poolitamine muudab lehtede arvu ja indekseid).

/** Praegusele JÄRGNEVA lehe failinimi (salvesta ENNE mutatsiooni), või null kui viimane. */
export function computeNextAnchor(filenamesBefore: string[], currentFilename: string): string | null {
  const i = filenamesBefore.indexOf(currentFilename);
  if (i === -1 || i + 1 >= filenamesBefore.length) return null;
  return filenamesBefore[i + 1];
}

/** Leiab uue indeksi pärast mutatsiooni; done=true kui dokument läbi. */
export function resolveIndexAfter(
  filenamesAfter: string[],
  anchor: string | null,
  currentFilename: string,
): { index: number; done: boolean } {
  if (anchor !== null) {
    const i = filenamesAfter.indexOf(anchor);
    if (i !== -1) return { index: i, done: false };
  }
  // Ankrut polnud (viimane leht) või kadus — proovi praegust (crop/rotate jäi paigale)
  const cur = filenamesAfter.indexOf(currentFilename);
  if (cur !== -1) return { index: cur, done: true };
  // Praegune kadus (nt split viimasel lehel) → viimane leht
  return { index: Math.max(0, filenamesAfter.length - 1), done: true };
}
