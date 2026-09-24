/**
 * Teose halduse ootel pöörded ja poolitused (#431 etapp 3, ADR 0050).
 *
 * Sama mudel nagu upload'i ülevaatuses: valitud lehtedele märgitakse toiming,
 * ruudustik näitab eelvaadet ja „Rakenda" saadab kõik ühe päringuga
 * (`POST /admin/work/{id}/page-ops`). Võti on failinimi — lehenumber nihkuks
 * iga poolitusega. Puhas moodul: ainult andmed, ei tea Reactist.
 */
import { addRotation } from '../../components/pagePrep/geometry';

export interface PendingPageOp {
  /** Pööre päripäeva: 0 | 90 | 180 | 270. Rakendub ENNE poolitust. */
  rotate: number;
  split: boolean;
}

export type PendingPageOps = Record<string, PendingPageOp>;

export interface PageOpRequest {
  filename: string;
  rotate: number;
  split_x: number | null;
}

/** Tühja kirjet ei hoita — nii tähendab võtme olemasolu alati „midagi ootel". */
function put(ops: PendingPageOps, filename: string, op: PendingPageOp): PendingPageOps {
  const next = { ...ops };
  if (op.rotate === 0 && !op.split) delete next[filename];
  else next[filename] = op;
  return next;
}

const current = (ops: PendingPageOps, fn: string): PendingPageOp =>
  ops[fn] ?? { rotate: 0, split: false };

/** Koguv pööre, nagu upload'is: kaks klõpsu paremale = 180°. */
export function rotatePending(ops: PendingPageOps, filenames: Iterable<string>, delta: number): PendingPageOps {
  let next = ops;
  for (const fn of filenames) {
    const op = current(next, fn);
    next = put(next, fn, { ...op, rotate: addRotation(op.rotate, delta) });
  }
  return next;
}

/** „Poolita" / „Ära poolita" valikule. Idempotentne, mõlemasuunaline. */
export function setPendingSplit(ops: PendingPageOps, filenames: Iterable<string>, split: boolean): PendingPageOps {
  let next = ops;
  for (const fn of filenames) next = put(next, fn, { ...current(next, fn), split });
  return next;
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

/** Päringu keha. `splitX` on üldjoon — üks väärtus kõigile poolitatavatele lehtedele. */
export function toRequest(ops: PendingPageOps, splitX: number): PageOpRequest[] {
  return Object.entries(ops).map(([filename, op]) => ({
    filename,
    rotate: op.rotate,
    split_x: op.split ? splitX : null,
  }));
}

/**
 * Kas kaardil saab joont näidata. 90°/270° pöörde korral on pisipilt CSS-iga
 * pööratud ja skaleeritud — joone asukoht selles kastis oleks oletus, seega
 * kaart näitab siis ainult märki. 0° ja 180° korral on kuvatud pildi mõõdud
 * samad, joon käib kuvatud (pööratud) pildi laiuse järgi.
 */
export function showsCardLine(op: PendingPageOp | undefined): boolean {
  return Boolean(op?.split) && (op!.rotate === 0 || op!.rotate === 180);
}
