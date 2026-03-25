/**
 * Filtriväärtuste normaliseerimine AdvancedFilters komponendis.
 * Ekstraheeritud et loogika oleks testiv.
 */
import type { FilterItem } from './facetUtils';

/**
 * Lahendab valitud žanri/tüübi väärtuse otsingufiltri jaoks.
 *
 * Kriitilise tähtsusega käitumine:
 * - Kui väärtus (nt Q861911) on üksuste listis → tagasta MUUTMATA.
 *   Mitte konverdi labeliks — see põhjustaks vale filtri (genre_et mitte genre_ids).
 * - Kui väärtust listis pole → proovi id→label kaardi kaudu teisendada
 *   (keeleülene normaliseerimine URL-parameetri tõlkimiseks).
 * - Fallback: crossLangMap → algne väärtus.
 */
export function resolveFilterValue(
  selectedValue: string | null,
  items: FilterItem[],
  idToLabel?: Record<string, string>,
  crossLangMap?: Record<string, string>
): string | null {
  if (!selectedValue) return null;
  if (items.some(item => item.value === selectedValue)) return selectedValue;
  if (idToLabel?.[selectedValue]) return idToLabel[selectedValue];
  return crossLangMap?.[selectedValue] ?? selectedValue;
}

/**
 * Lahendab valitud väärtuse item.value formaadis (kasutatakse pill highlightimiseks).
 * - Kui väärtus on juba listis → tagasta see.
 * - Kui on label → proovi labelToId kaudu Q-kood leida.
 * - Muidu → null (pill ei kuvata aktiivsena).
 */
export function resolveItemValue(
  selectedValue: string | null,
  items: FilterItem[],
  labelToId?: Record<string, string>
): string | null {
  if (!selectedValue) return null;
  if (items.some(item => item.value === selectedValue)) return selectedValue;
  const qcode = labelToId?.[selectedValue];
  if (qcode && items.some(item => item.value === qcode)) return qcode;
  return null;
}
