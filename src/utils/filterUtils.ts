/**
 * Puhtas filtri ehitamise loogika Meilisearch päringute jaoks.
 * Ekstraheeritud searchService.ts-ist, et oleks testiv.
 */
import { isQCode } from './qcodeUtils';

/**
 * Meilisearchi filtri stringiliteraal. Escape'itakse kurakaldkriips ja jutumärk
 * (selles järjekorras) — `"` või `\` väärtuses (URL-i parameeter, märksõna)
 * murdis muidu filtri või andis 400 (#616). Sama reegel serveri
 * `_filter_value`-is ja MCP `_quote`-is. Juurdepääsu see ei mõjuta: selle
 * jõustab tenant-tokeni reegel, mitte kliendi filter.
 */
export function quoteFilterValue(value: string | number): string {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Ühe märksõna filtritingimus: Q-kood/vutt:ID → tags_ids, muidu keelespetsiifiline OR */
export function buildTagFilter(tag: string): string {
  if (isQCode(tag) || tag.startsWith('vutt:')) {
    return `tags_ids = ${quoteFilterValue(tag)}`;
  }
  return `(tags_et = ${quoteFilterValue(tag)} OR tags_en = ${quoteFilterValue(tag)})`;
}

/** Ühe lehekülje märksõna filtritingimus: Q-kood → page_tags_ids, muidu keelespetsiifiline OR */
export function buildPageTagFilter(tag: string): string {
  if (isQCode(tag)) {
    return `page_tags_ids = ${quoteFilterValue(tag)}`;
  }
  return `(page_tags_et = ${quoteFilterValue(tag)} OR page_tags_en = ${quoteFilterValue(tag)})`;
}

/** Ühe žanri filtritingimus: Q-kood → genre_ids, label → bilinguaalne OR */
export function buildGenreFilter(genre: string): string {
  if (isQCode(genre)) return `genre_ids = ${quoteFilterValue(genre)}`;
  return `(genre_et = ${quoteFilterValue(genre)} OR genre_en = ${quoteFilterValue(genre)})`;
}

/** Ühe tüübi filtritingimus: Q-kood → type_ids, label → bilinguaalne OR */
export function buildTypeFilter(type: string): string {
  if (isQCode(type)) return `type_ids = ${quoteFilterValue(type)}`;
  return `(type_et = ${quoteFilterValue(type)} OR type_en = ${quoteFilterValue(type)})`;
}

/** Trükkali filtritingimus: Q-kood → publisher_id, muidu label täpne vaste */
export function buildPrinterFilter(printer: string): string {
  if (isQCode(printer)) return `publisher_id = ${quoteFilterValue(printer)}`;
  return `publisher = ${quoteFilterValue(printer)}`;
}

/**
 * Mitme väärtuse OR-filter (ühe väärtuse puhul ilma sulududeta).
 * Kasutatakse žanri ja tüübi filtrite jaoks.
 */
export function buildMultiFilter(values: string[], buildSingle: (v: string) => string): string {
  const conditions = values.map(buildSingle);
  return values.length === 1 ? conditions[0] : `(${conditions.join(' OR ')})`;
}
