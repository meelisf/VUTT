/**
 * Lehe sünkroniseerimise otsused `useEditorState` `page`-effectis.
 *
 * **Miks eraldi mõiste "lehevahetus":** effect jookseb iga `page`-objekti
 * asendumise peale, aga neid on kaht liiki. Päris lehevahetus (kasutaja lappas)
 * peab alustama lehte algusest. Sama lehe värskendus (`Workspace` `setPage`
 * salvestamise või metaandmete muutmise järel) EI tohi kerimist ega kursorit
 * liigutada — kasutaja on keset tööd ja salvestab vahepeal.
 *
 * Enne #190-t monteeriti editor lehe vahetusel maha ja kerimine algas nullist
 * iseenesest. Kui editor jäi püsima (ADR 0010), lisandus selge lähtestus — ja
 * hakkas ekslikult käima ka salvestamisel.
 */

interface SelectionAfterSyncParams {
  /** Kas tegu on päris lehevahetusega (vt `isPageSwap`). */
  isSwap: boolean;
  /** Kursori praegune asukoht editoris. */
  currentAnchor: number;
  /** Uue dokumendi pikkus märkides. */
  newDocLength: number;
}

/**
 * Kas `page` vahetus tähendab teist lehekülge.
 *
 * Võrdlus käib `Page.id` (Meilisearchi primaarvõti, nt `"cymbv7-1"`) järgi, mis
 * sisaldab nii teose nanoidi kui lehenumbrit — seega katab ka teose vahetuse.
 * Objekti-identiteet EI kõlba: salvestamine loob sama lehe kohta uue objekti.
 *
 * @param prevPageId Eelmine nähtud lehe ID, `null` esmasel renderdusel
 */
export function isPageSwap(prevPageId: string | null, nextPageId: string): boolean {
  return prevPageId !== nextPageId;
}

/**
 * Kursori asukoht pärast dokumendi programmaatilist asendust.
 *
 * Lehevahetusel algusesse — muidu jääks kursor eelmise lehe pealt suvalisse
 * kohta uues tekstis. Sama lehe värskendusel jääb kursor paigale, lõigatuna uue
 * dokumendi pikkusele: server võib salvestamisel teksti normaliseerida
 * (`normalize_marginalia_tags` eemaldab tühjad tagid), nii et salvestatud tekst
 * on lühem kui see, mis editoris oli.
 */
export function selectionAfterSync({
  isSwap,
  currentAnchor,
  newDocLength,
}: SelectionAfterSyncParams): number {
  if (isSwap) return 0;
  if (!Number.isFinite(currentAnchor)) return 0;
  return Math.max(0, Math.min(currentAnchor, newDocLength));
}
