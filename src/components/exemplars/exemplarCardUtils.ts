/**
 * Infopaneeli eksemplarikaartide puhas loogika (ADR 0076). Kaardil on ainult
 * lühiinfo; pikem info (paber, vaatlused) tuleb eraldi vahekaardile.
 */
import type { ArchiveRef, Exemplar } from '../../types';

/** Transkriptsiooni alus esimesena, teised salvestatud järjekorras (massiivi järjekord = kuvamisjärjekord). */
export function orderExemplars(exemplars: Exemplar[]): Exemplar[] {
  const witness = exemplars.filter(x => x.text_witness);
  return [...witness, ...exemplars.filter(x => !x.text_witness)];
}

/** Lehenumbrid lühikujul: [1, 2, 3, 7] → "1–3, 7". */
export function formatPageNumbers(nums: number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? String(start) : `${start}–${sorted[i]}`);
  }
  return parts.join(', ');
}

/** Erandlehtede numbrid (ADR 0076 reegel 5); tundmatu tüvi jäetakse vahele. */
export function exceptionPages(x: Exemplar, pageNumbers: Record<string, number>): string {
  const nums = (x.pages || []).map(s => pageNumbers[s]).filter((n): n is number => typeof n === 'number');
  return formatPageNumbers(nums);
}

/**
 * Käsikirja viide päiseribale: hoidja + kohaviit. Käsikirjal on üks eksemplar
 * (ADR 0076 p 2), seega valikut pole; puuduv viide → null.
 */
export function manuscriptRefLabel(type: { id?: string | null } | null | undefined, refs: ArchiveRef[] | null | undefined): string | null {
  if (type?.id !== 'Q87167' || !refs?.length) return null;
  const r = refs[0];
  return [r.archive_id, r.reference].filter(Boolean).join(' ') || null;
}
