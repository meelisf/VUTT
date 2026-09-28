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

interface KeepEditorTextParams {
  isSwap: boolean;
  /** Serverist tulnud lehe tekst. */
  incomingText: string;
  /** Viimati salvestatud tekst (`savedState.text`). */
  savedText: string;
  /** Redaktori praegune tekst. */
  editorText: string;
}

/**
 * Kas sama lehe värskendus peab redaktori teksti puutumata jätma.
 *
 * Kui serverist tuli sama tekst, mis viimati salvestati, pole serveril midagi
 * uut — redaktori erinev sisu on kasutaja salvestamata töö ja üle kirjutamine
 * kustutaks selle (kkrxpe, 2026-09-28: iga Meili tokeni uuendus laadis lehe
 * uuesti). Salvestus ise tuleb teise tekstiga (normaliseeritud uus tekst,
 * `savedState` on siis veel vana) ja asendub nagu enne.
 */
export function keepEditorText({ isSwap, incomingText, savedText, editorText }: KeepEditorTextParams): boolean {
  return !isSwap && incomingText === savedText && editorText !== savedText;
}
