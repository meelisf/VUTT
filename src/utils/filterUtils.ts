/**
 * Puhtas filtri ehitamise loogika Meilisearch päringute jaoks.
 * Ekstraheeritud searchService.ts-ist, et oleks testiv.
 */
import { isQCode } from './qcodeUtils';

/** Ühe märksõna filtritingimus: Q-kood/vutt:ID → tags_ids, muidu keelespetsiifiline OR */
export function buildTagFilter(tag: string): string {
  if (isQCode(tag) || tag.startsWith('vutt:')) {
    return `tags_ids = "${tag}"`;
  }
  return `(tags_et = "${tag}" OR tags_en = "${tag}")`;
}

/** Ühe lehekülje märksõna filtritingimus: Q-kood → page_tags_ids, muidu keelespetsiifiline OR */
export function buildPageTagFilter(tag: string): string {
  if (isQCode(tag)) {
    return `page_tags_ids = "${tag}"`;
  }
  return `(page_tags_et = "${tag}" OR page_tags_en = "${tag}")`;
}

/** Ühe žanri filtritingimus: Q-kood → genre_ids, label → bilinguaalne OR */
export function buildGenreFilter(genre: string): string {
  if (isQCode(genre)) return `genre_ids = "${genre}"`;
  return `(genre_et = "${genre}" OR genre_en = "${genre}")`;
}

/** Ühe tüübi filtritingimus: Q-kood → type_ids, label → bilinguaalne OR */
export function buildTypeFilter(type: string): string {
  if (isQCode(type)) return `type_ids = "${type}"`;
  return `(type_et = "${type}" OR type_en = "${type}")`;
}

/** Trükkali filtritingimus: Q-kood → publisher_id, muidu label täpne vaste */
export function buildPrinterFilter(printer: string): string {
  if (isQCode(printer)) return `publisher_id = "${printer}"`;
  return `publisher = "${printer}"`;
}

/**
 * Mitme väärtuse OR-filter (ühe väärtuse puhul ilma sulududeta).
 * Kasutatakse žanri ja tüübi filtrite jaoks.
 */
export function buildMultiFilter(values: string[], buildSingle: (v: string) => string): string {
  const conditions = values.map(buildSingle);
  return values.length === 1 ? conditions[0] : `(${conditions.join(' OR ')})`;
}
