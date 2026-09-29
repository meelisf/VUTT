// src/pages/admin/placePeriods.ts
/** Asutuse koht ajas registri adminivaates: üks rida perioodi kohta, „Dorpat: –1699". */
import type { PlacePeriod } from '../../prosopography/services/prosopographyService';

export function formatPlacePeriods(periods: PlacePeriod[] | undefined): string {
  return (periods ?? []).map(p => {
    const span = p.from === undefined && p.to === undefined ? '' : `: ${p.from ?? ''}–${p.to ?? ''}`;
    return `${p.place_key}${span}`;
  }).join('\n');
}

/**
 * Vigase rea põhjus: `format` — rida ei ole „võti: algus–lõpp" kujul;
 * `years_only` — ainult aastad, koht puudub (tüüpiline eksitus: tegutsemisaeg);
 * `unknown_place` — võtit ei ole kohtade registris.
 */
export type PlacePeriodError = { errorLine: number; reason: 'format' | 'years_only' | 'unknown_place'; value: string };

/**
 * Tagastab perioodid või esimese vigase rea (1-põhine). `placeKeys` antakse, kui
 * kohtade register on laetud — siis püüab klient kinni ka tundmatu võtme, mille
 * server muidu paljaks `unknown_place_key`-ks teeks.
 */
export function parsePlacePeriods(text: string, placeKeys?: ReadonlySet<string>):
  { periods: PlacePeriod[] } | PlacePeriodError {
  const periods: PlacePeriod[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^[\d\s–-]+$/.test(line)) return { errorLine: i + 1, reason: 'years_only', value: line };
    const m = /^([^:]+?)\s*(?::\s*(\d{4})?\s*[-–]\s*(\d{4})?)?$/.exec(line);
    if (!m) return { errorLine: i + 1, reason: 'format', value: line };
    const [, place_key, from, to] = m;
    if (from && to && Number(from) > Number(to)) return { errorLine: i + 1, reason: 'format', value: line };
    if (placeKeys && !placeKeys.has(place_key)) return { errorLine: i + 1, reason: 'unknown_place', value: place_key };
    periods.push({ place_key, ...(from ? { from: Number(from) } : {}), ...(to ? { to: Number(to) } : {}) });
  }
  return { periods };
}
