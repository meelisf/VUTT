import type { PrepressPage, PrepressPlan } from './types';

/**
 * Muudab globaalset poolitusjoont. `custom` ja `nosplit` lehti EI puutu —
 * admini käsitsi tehtud töö peab jääma alles.
 */
export function applyGlobalSplit(plan: PrepressPlan, x: number): PrepressPlan {
  return { ...plan, default_split_x: x, pages: plan.pages.map((p) => ({ ...p })) };
}

export interface PlanSummary {
  split: number;
  excluded: number;
  output: number;
}

/** Kokkuvõtteriba arvud. Puhas — komponent ainult vormindab.
 *  „poolitatakse N" loeb AINULT OCR-i minevaid poolitatud lehti (§11). */
export function summarizePlan(plan: PrepressPlan): PlanSummary {
  return {
    split: plan.pages.filter((p) => !p.excluded && p.mode !== 'nosplit').length,
    excluded: plan.pages.filter((p) => p.excluded).length,
    output: countOutputPages(plan),
  };
}

/** Mitu lehte OCR-i läheb. Peegeldab serveri output_page_count loogikat. */
export function countOutputPages(plan: PrepressPlan): number {
  return plan.pages.reduce((total, page) => {
    if (page.excluded) return total;
    if (page.mode === 'nosplit') return total + 1;
    if (page.mode === 'custom' && page.split_x == null) return total + 1;
    return total + 2;
  }, 0);
}

/**
 * Hoiab poolitusjoone vahemikus, kus mõlemad pooled jäävad sisukaks.
 * Vastab backendi `page_cuts` servapiirangule (`max(1, min(width - 1, …))`),
 * ainult heldemalt — 5% servast pole kunagi õige poolituskoht.
 */
export function clampSplitX(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return Math.min(0.95, Math.max(0.05, x));
}

/**
 * Kas lehe n eelvaate fail on serveris juba olemas.
 *
 * KRIITILINE `<img src>` jaoks: valmimata lehe pilt annab 404 ja jääb
 * PÜSIVALT katki — eelvaate polling uuendab plaani, aga `src` string ei
 * muutu, seega React ei puutu DOM-i img-elementi ja brauser ei proovi
 * uuesti. Ainult remount (vaate vahetus, lehe laadimine) päästaks.
 * Sama muster nagu UploadStepReview `entry.has_ocr` juures.
 *
 * `preview_done` on serveris usaldusväärne: `_render_previews` seab selle
 * alles PÄRAST faili kirjutamist.
 */
export function isPreviewReady(plan: PrepressPlan, n: number): boolean {
  if (plan.preview_status === 'ready') return true;
  return n <= plan.preview_done;
}

/**
 * Kas leht n TEGELIKULT poolitatakse. Üks tõe allikas kõigile vaadetele:
 * kontaktlehe joon, üksiklehe joon+käepide ja kokkuvõtte arvud peavad kõik
 * sama vastust andma. Peegeldab serveri `effective_split_x` + `is_excluded`
 * loogikat (server/upload/prepress_plan.py).
 */
export function willSplit(plan: PrepressPlan, n: number): boolean {
  const page = plan.pages.find((p) => p.n === n);
  if (!page || page.excluded) return false;
  if (page.mode === 'nosplit') return false;
  if (page.mode === 'custom' && page.split_x == null) return false;
  return true;
}

/** Muudab valitud (või kõik) lehed uue kirje järgi. Puhas: uus plaan, uued lehed. */
function mapPages(
  plan: PrepressPlan,
  ns: number[] | undefined,
  fn: (page: PrepressPage) => PrepressPage,
): PrepressPlan {
  const touch = ns ? new Set(ns) : null;
  return {
    ...plan,
    pages: plan.pages.map((p) => (!touch || touch.has(p.n) ? fn({ ...p }) : { ...p })),
  };
}

/**
 * „Poolita kõik" (või valikule „Poolita"): nosplit → default.
 * `custom` jääb PUUTUMATA — käsitsi tehtud töö on väärtuslikum kui hulgikäsk (§7).
 * Nimi on tahtlik: see EI ole „poolita", vaid „rakenda üldjoont".
 */
export function applyDefaultSplitTo(plan: PrepressPlan, ns?: number[]): PrepressPlan {
  return mapPages(plan, ns, (p) => (p.mode === 'custom' ? p : { ...p, mode: 'default', split_x: null }));
}

/**
 * „Eemalda üldpoolitus": default → nosplit. `custom` jääb puutumata (§2).
 * Vana nimi „Ära poolita ühtki" lubas rohkem, kui see teeb.
 */
export function clearDefaultSplit(plan: PrepressPlan): PrepressPlan {
  return mapPages(plan, undefined, (p) => (p.mode === 'default' ? { ...p, mode: 'nosplit', split_x: null } : p));
}

/**
 * Tegevusriba „Ära poolita": valitud lehed → nosplit, KA custom.
 * Kaitse kehtib globaalsetele nuppudele, mitte valikule — kasutaja näitas
 * need lehed nimeliselt kätte (§7).
 */
export function setNoSplit(plan: PrepressPlan, ns: number[]): PrepressPlan {
  return mapPages(plan, ns, (p) => ({ ...p, mode: 'nosplit', split_x: null }));
}

/**
 * „Ära OCR-i" / „Lisa OCR-i". Puudutab AINULT `excluded` välja: poolitusolek
 * säilib ja hakkab uuesti kehtima, kui leht OCR-i tagasi lisatakse (§11).
 */
export function setExcluded(plan: PrepressPlan, ns: number[], excluded: boolean): PrepressPlan {
  return mapPages(plan, ns, (p) => ({ ...p, excluded }));
}

/** „27 lehte sai üldjoone, 3 käsitsi seatut jäi puutumata" — riba teate arvud (§7). */
export function countByMode(plan: PrepressPlan, ns: number[]): { applied: number; keptCustom: number } {
  const touch = new Set(ns);
  const picked = plan.pages.filter((p) => touch.has(p.n));
  const keptCustom = picked.filter((p) => p.mode === 'custom').length;
  return { applied: picked.length - keptCustom, keptCustom };
}
