import type { PrepressPlan } from './types';

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

/** Kokkuvõtteriba arvud. Puhas — komponent ainult vormindab. */
export function summarizePlan(plan: PrepressPlan): PlanSummary {
  return {
    split: plan.enabled
      ? plan.pages.filter((p) => !p.excluded && p.mode !== 'nosplit').length
      : 0,
    excluded: plan.pages.filter((p) => p.excluded).length,
    output: countOutputPages(plan),
  };
}

/** Mitu lehte OCR-i läheb. Peegeldab serveri output_page_count loogikat. */
export function countOutputPages(plan: PrepressPlan): number {
  return plan.pages.reduce((total, page) => {
    if (page.excluded) return total;
    if (!plan.enabled || page.mode === 'nosplit') return total + 1;
    if (page.mode === 'custom' && page.split_x == null) return total + 1;
    return total + 2;
  }, 0);
}

/** Pidevuse lävi, millest alates tume riba loetakse köitemurdeks, mitte kirjaks. */
const FOLD_CONTINUITY = 0.5;

/**
 * Tindiskoori tase värvi jaoks, arvestades tindi PIDEVUST.
 *
 * Ainult ink ei erista köitemurret kirjast: mõõdetuna andis õige poolituskoht
 * (täpselt murdejoonel) ink 0,45 — hoiatus oleks käivitunud õige vastuse peale.
 * Pidev tume joon = murre = ok; katkendlik tint samal tasemel = kiri = hoiatus.
 *
 * Madal ink on alati ok — kõik skännid ei ole murdejoonega, hele köitevahe on
 * täiesti korrektne. Arvutamata skoor (null) on samuti `ok`, muidu oleks pool
 * kontaktlehest punane juba enne renderduse lõppu.
 */
export function inkLevel(
  ink: number | null,
  continuity?: number | null,
): 'ok' | 'warn' | 'bad' {
  if (ink == null) return 'ok';
  if (ink < 0.25) return 'ok';
  // Pidev tume joon ülalt alla = köitemurre, mitte kiri. Just seal ONGI õige
  // poolituskoht — mõõdetuna andis murdejoon ink 0,45 ja pidevus ~1,0, samal
  // ajal kui tekst samal tinditasemel annab pidevuse < 0,05.
  if (continuity != null && continuity >= FOLD_CONTINUITY) return 'ok';
  if (ink >= 0.8) return 'bad';
  return 'warn';
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
  if (!plan.enabled) return false;
  const page = plan.pages.find((p) => p.n === n);
  if (!page || page.excluded) return false;
  if (page.mode === 'nosplit') return false;
  if (page.mode === 'custom' && page.split_x == null) return false;
  return true;
}
