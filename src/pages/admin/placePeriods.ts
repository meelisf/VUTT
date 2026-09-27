// src/pages/admin/placePeriods.ts
/** Asutuse koht ajas registri adminivaates: üks rida perioodi kohta, „Dorpat: –1699". */
import type { PlacePeriod } from '../../prosopography/services/prosopographyService';

export function formatPlacePeriods(periods: PlacePeriod[] | undefined): string {
  return (periods ?? []).map(p => {
    const span = p.from === undefined && p.to === undefined ? '' : `: ${p.from ?? ''}–${p.to ?? ''}`;
    return `${p.place_key}${span}`;
  }).join('\n');
}

/** Tagastab perioodid või vigase rea numbri (1-põhine). */
export function parsePlacePeriods(text: string): { periods: PlacePeriod[] } | { errorLine: number } {
  const periods: PlacePeriod[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = /^([^:]+?)\s*(?::\s*(\d{4})?\s*[-–]\s*(\d{4})?)?$/.exec(line);
    if (!m) return { errorLine: i + 1 };
    const [, place_key, from, to] = m;
    if (from && to && Number(from) > Number(to)) return { errorLine: i + 1 };
    periods.push({ place_key, ...(from ? { from: Number(from) } : {}), ...(to ? { to: Number(to) } : {}) });
  }
  return { periods };
}
