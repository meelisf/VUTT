import type { EnrichmentEvidence } from '../services/prosopographyService';

const QUOTE_MAX = 160;

export interface EvidenceRef {
  href: string | null;
  /** Välislink (vana veebitõend) avaneb uues aknas; VUTT-i leht on sisemine marsruut. */
  external: boolean;
  title: string;
  locator: string;
  quote: string;
}

/** Tõend → loetav viide. Linki antakse ainult VUTT-i lehele ja http(s)-URL-ile:
 *  vanadel kaartidel on veebitõendeid, mille `url` on vaba string. */
export function evidenceRef(source: EnrichmentEvidence,
  titleOf: (workId: string) => string | undefined, pageLabel: string): EvidenceRef {
  const quote = source.quote && source.quote.length > QUOTE_MAX
    ? `${source.quote.slice(0, QUOTE_MAX)}…` : (source.quote ?? '');
  if (source.source_kind === 'vutt_page' && source.work_id) {
    const page = source.printed_page || (source.page ? String(source.page) : '');
    return {
      href: `/work/${encodeURIComponent(source.work_id)}/${source.page ?? 1}`, external: false,
      title: titleOf(source.work_id) || source.work_id,
      locator: page ? `${pageLabel} ${page}` : '', quote,
    };
  }
  const url = source.url && /^https?:\/\//i.test(source.url) ? source.url : null;
  return {
    href: url, external: Boolean(url),
    title: source.citation || source.source_id || source.url || source.source_kind,
    locator: source.locator ?? '', quote,
  };
}

/** Kõigi kirjete tõendite unikaalsed work_id-d (pealkirjade päringuks). */
export function evidenceWorkIds(entries: Array<{ evidence?: unknown }>): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!Array.isArray(entry?.evidence)) continue;
    for (const source of entry.evidence as EnrichmentEvidence[]) {
      if (source?.source_kind === 'vutt_page' && source.work_id) ids.add(source.work_id);
    }
  }
  return [...ids];
}
