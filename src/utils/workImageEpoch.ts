/**
 * Teose pildiversioon lehesessiooni piires.
 *
 * Halduse pildimuutus (kärbe, pööre, poolitus, asendus, originaali taaste)
 * kirjutab sama failinime üle. Töölaua pildi-URL ei kanna versiooni ja
 * viewer-token püsib kontekstis, nii et teose juurde naastes on URL bait-täpselt
 * sama — brauser võtab sama dokumendi (SPA) piires pildi mälust ega küsi
 * serverilt üldse, `Cache-Control: no-cache`-ist hoolimata. Nähtav oli vana
 * pilt kuni käsitsi värskenduseni (2026-11-17).
 *
 * Võti on teos, mitte leht: poolitus nihutab lehenumbreid ja lehepõhine võti
 * (varem `vutt_replaced_images`) osutaks valele lehele. Hind: pärast muudatust
 * laeb töölaud selle teose pildid sessioonis ühe korra uuesti.
 */

const STORAGE_KEY = 'vutt_work_image_epoch';

function readAll(): Record<string, number> {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Märgib, et teose pildid muutusid. Kutsu pärast iga pildimuutust halduses. */
export function bumpWorkImageEpoch(workId: string | undefined, now: number = Date.now()): void {
  if (!workId) return;
  try {
    const all = readAll();
    all[workId] = now;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* salvestuskoha viga — halvimal juhul jääb vana pilt kuni värskenduseni */
  }
}

/** Teose pildiversioon või `null`, kui selles sessioonis muudatust pole olnud. */
export function getWorkImageEpoch(workId: string | undefined): number | null {
  if (!workId) return null;
  const v = readAll()[workId];
  return typeof v === 'number' ? v : null;
}

/** Lisab URL-ile `v=<versioon>`, kui teose pilte on selles sessioonis muudetud. */
export function withWorkImageEpoch(url: string, epoch: number | null): string {
  if (!url || epoch == null) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${epoch}`;
}
