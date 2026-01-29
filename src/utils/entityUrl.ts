/**
 * Genereerib URL-i linked data entiteedile sõltuvalt ID formaadist.
 *
 * Toetatud formaadid:
 * - Wikidata Q-koodid (Q12345) → wikidata.org
 * - VIAF koodid → viaf.org
 * - Album Academicum (AA:123) → null (pole avalik)
 * - Tundmatud → null
 */
export function getEntityUrl(id: string | null | undefined, source?: string): string | null {
  if (!id) return null;

  // Wikidata Q-koodid
  if (id.startsWith('Q') && /^Q\d+$/.test(id)) {
    return `https://www.wikidata.org/wiki/${id}`;
  }

  // VIAF koodid (VIAF:12345 või viaf:12345)
  if (source === 'viaf' || id.toUpperCase().startsWith('VIAF:')) {
    const viafId = id.replace(/^viaf:/i, '');
    return `https://viaf.org/viaf/${viafId}`;
  }

  // Album Academicum - pole avalikult kättesaadav
  if (id.startsWith('AA:') || source === 'album_academicum') {
    return null;
  }

  // Tundmatu formaat - linki ei tee
  return null;
}

/**
 * Kontrollib, kas ID on linkitav (kas URL on olemas).
 */
export function isLinkableEntity(id: string | null | undefined, source?: string): boolean {
  return getEntityUrl(id, source) !== null;
}
