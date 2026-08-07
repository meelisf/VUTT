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

/**
 * Tindiskoori tase värvi jaoks. Usaldusväärne AINULT kõrge väärtuse suunas:
 * kõrge skoor = joon lõikab kindlasti midagi; madal skoor EI tähenda õiget
 * kohta (tühi veeris skoorib samuti 0). Arvutamata skoor (null) on `ok`,
 * mitte hoiatus — muidu oleks pool kontaktlehest punane enne renderdust.
 */
export function inkLevel(ink: number | null): 'ok' | 'warn' | 'bad' {
  if (ink == null) return 'ok';
  if (ink >= 0.8) return 'bad';
  if (ink >= 0.25) return 'warn';
  return 'ok';
}

/**
 * Virtualiseerimise aken [start, end) horisontaalses ribavaates.
 * 300-lehelise teose puhul ei tohi kõiki ribasid korraga tellida — iga riba
 * on eraldi 300 DPI renderdus serveris.
 */
export function visibleWindow(
  scrollLeft: number,
  itemWidth: number,
  viewportWidth: number,
  total: number,
  overscan = 3,
): [number, number] {
  const first = Math.floor(scrollLeft / itemWidth);
  const last = first + Math.ceil(viewportWidth / itemWidth);
  const end = Math.min(total, last + overscan);
  const start = Math.min(Math.max(0, first - overscan), end);
  return [start, end];
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
