/**
 * OCR-pakkuja veakood → i18n võti (#292).
 *
 * Server annab masinloetava prefiksi (`content_blocked: …`, sama konventsioon
 * mis `request_too_large`), lause renderdatakse siin pool lugeja PRAEGUSES
 * keeles, lugemise hetkel (ADR 0033). Serveri enda sõnum on varuvariant:
 * tundmatu koodi puhul on toores tekst parem kui üldine „midagi läks valesti",
 * sest see on ainus diagnostiline jälg, mis kasutajani jõuab.
 */

// Koodid, mille kohta oskame kasutajale midagi KASULIKKU öelda. Kood, mille
// tõlge ütleks ainult „viga", ei kuulu siia — ta peidaks serveri sõnumi ära.
const KOODI_VOTMED = new Map<string, string>([
  ['content_blocked', 'common:errors.ocr.content_blocked'],
]);

export function ocrErrorKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Kood on PREFIKS. `includes` sobitaks ka API vabateksti, kus kood esineb
  // tsitaadina, ja annaks kasutajale vale nõuande.
  const kood = raw.split(':', 1)[0].trim();
  return KOODI_VOTMED.get(kood) ?? null;
}

/**
 * Kuvatav lause. `t` on kutsuja oma tõlkefunktsioon — nii renderdub tekst lugeja
 * PRAEGUSES keeles ja keelevahetus mõjub kohe, ka juba kuvatud veale.
 *
 * Kutsuja nimeruumide loend PEAB sisaldama `common`-it.
 */
export function ocrErrorText(
  raw: string | null | undefined,
  t: (key: string) => string,
): string {
  const key = ocrErrorKey(raw);
  if (key) return t(key);
  return raw || t('common:errors.unknownError');
}
