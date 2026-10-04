/**
 * Teose halduse ootel pöörded, kärped ja poolitused (#431 etapp 3, ADR 0050, ADR 0061).
 *
 * Sama mudel nagu upload'i ülevaatuses: valitud lehtedele märgitakse toiming,
 * ruudustik näitab eelvaadet ja „Rakenda" saadab kõik ühe päringuga
 * (`POST /admin/work/{id}/page-ops`). Võti on failinimi — lehenumber nihkuks
 * iga poolitusega. Puhas moodul: ainult andmed, ei tea Reactist.
 */
import { addRotation } from '../../components/pagePrep/geometry';
import type { PageAdjust } from '../upload/types';

export interface PendingPageOp {
  /** Pööre päripäeva: 0 | 90 | 180 | 270. Rakendub ENNE poolitust. */
  rotate: number;
  /** Kalle/kärbe/perspektiiv PÖÖRATUD lehe raamis (ADR 0049): pööre → adjust → poolitus.
   *  Puudub = teisendust ei ole. Pöörde muutus eemaldab selle (raam muutub). */
  adjust?: PageAdjust;
  split: boolean;
  /** Lehekohane joon (0..1) pildiredaktorist; puudub/null = üldjoon.
   *  Sama tähendus nagu upload'i `mode: "custom"` + `split_x`. */
  split_x?: number | null;
}

export type PendingPageOps = Record<string, PendingPageOp>;

export interface PageOpRequest {
  filename: string;
  rotate: number;
  adjust: PageAdjust | null;
  split_x: number | null;
}

/** Tühja kirjet ei hoita — nii tähendab võtme olemasolu alati „midagi ootel". */
function put(ops: PendingPageOps, filename: string, op: PendingPageOp): PendingPageOps {
  const next = { ...ops };
  if (op.rotate === 0 && !op.split && !op.adjust) delete next[filename];
  else next[filename] = op;
  return next;
}

const current = (ops: PendingPageOps, fn: string): PendingPageOp =>
  ops[fn] ?? { rotate: 0, split: false };

/**
 * Uus pööre lehele. Kärbe (`adjust`) on EELMISE pöörde raamis ja muutuks uues
 * raamis valeks — pöörde muutus eemaldab selle (sama mis upload'i `withRotation`).
 */
function withRotation(op: PendingPageOp, rotate: number): PendingPageOp {
  if (op.adjust && rotate !== op.rotate) {
    const { adjust: _drop, ...rest } = op;
    return { ...rest, rotate };
  }
  return { ...op, rotate };
}

/** Koguv pööre, nagu upload'is: kaks klõpsu paremale = 180°. */
export function rotatePending(ops: PendingPageOps, filenames: Iterable<string>, delta: number): PendingPageOps {
  let next = ops;
  for (const fn of filenames) {
    const op = current(next, fn);
    next = put(next, fn, withRotation(op, addRotation(op.rotate, delta)));
  }
  return next;
}

/**
 * Pildiredaktori „Märgi": pööre JA kärbe korraga — kärpekast joonistati selle
 * pöörde raamis. `adjust` null = ainult pööre (olemasolev kärbe kaob).
 */
export function setPendingEdit(ops: PendingPageOps, filename: string, rotate: number, adjust: PageAdjust | null): PendingPageOps {
  const { adjust: _old, ...rest } = current(ops, filename);
  return put(ops, filename, adjust ? { ...rest, rotate, adjust } : { ...rest, rotate });
}

/** „Eemalda kärbe": pööre ja poolitus jäävad. */
export function clearPendingAdjust(ops: PendingPageOps, filenames: Iterable<string>): PendingPageOps {
  let next = ops;
  for (const fn of filenames) {
    const op = next[fn];
    if (!op?.adjust) continue;
    const { adjust: _drop, ...rest } = op;
    next = put(next, fn, rest);
  }
  return next;
}

/**
 * „Poolita" / „Ära poolita" valikule. Idempotentne, mõlemasuunaline.
 * „Poolita" jätab lehekohase joone PUUTUMATA (käsitsi seatud joon on
 * väärtuslikum kui hulgikäsk, nagu upload'i `applyDefaultSplitTo`);
 * „Ära poolita" kustutab ka selle (nagu upload'i `setNoSplit`).
 */
export function setPendingSplit(ops: PendingPageOps, filenames: Iterable<string>, split: boolean): PendingPageOps {
  let next = ops;
  for (const fn of filenames) {
    const op = current(next, fn);
    next = put(next, fn, split ? { ...op, split: true } : { ...op, split: false, split_x: null });
  }
  return next;
}

/** Pildiredaktori joon: märgib lehe poolitatavaks oma joonega; null = tagasi üldjoonele. */
export function setPendingSplitX(ops: PendingPageOps, filename: string, x: number | null): PendingPageOps {
  return put(ops, filename, { ...current(ops, filename), split: true, split_x: x });
}

/** Lehe tegelik joon: lehekohane või üldjoon. */
export function effectiveSplitX(op: PendingPageOp | undefined, splitX: number): number {
  return op?.split_x ?? splitX;
}

/** Viskab välja kirjed, mille leht on vahepeal kadunud (kustutatud, redaktoris poolitatud). */
export function pruneMissing(ops: PendingPageOps, existing: Iterable<string>): PendingPageOps {
  const keep = new Set(existing);
  const next: PendingPageOps = {};
  let changed = false;
  for (const [fn, op] of Object.entries(ops)) {
    if (keep.has(fn)) next[fn] = op;
    else changed = true;
  }
  return changed ? next : ops;
}

export function pendingCount(ops: PendingPageOps): number {
  return Object.keys(ops).length;
}

/** Päringu keha. `splitX` on üldjoon — kehtib lehtedele, millel oma joont ei ole. */
export function toRequest(ops: PendingPageOps, splitX: number): PageOpRequest[] {
  return Object.entries(ops).map(([filename, op]) => ({
    filename,
    rotate: op.rotate,
    adjust: op.adjust ?? null,
    split_x: op.split ? effectiveSplitX(op, splitX) : null,
  }));
}

/**
 * Kas kaardil saab joont näidata. 90°/270° pöörde korral on pisipilt CSS-iga
 * pööratud ja skaleeritud — joone asukoht selles kastis oleks oletus, seega
 * kaart näitab siis ainult märki. 0° ja 180° korral on kuvatud pildi mõõdud
 * samad, joon käib kuvatud (pööratud) pildi laiuse järgi.
 */
export function showsCardLine(op: PendingPageOp | undefined): boolean {
  if (!op?.split) return false;
  // Kärpega leht näidatakse serveri eelvaatena (pööre + kärbe juba sees) →
  // joon käib eelvaate laiuse järgi igal pöördel.
  return Boolean(op.adjust) || op.rotate === 0 || op.rotate === 180;
}

/** Kas kaart vajab serveri eelvaadet (CSS ei oska kärbet/kallet näidata). */
export function needsServerPreview(op: PendingPageOp | undefined): boolean {
  return Boolean(op?.adjust);
}
