// src/prosopography/utils/registryMatch.ts
/**
 * Ameti- ja asutuseregistri otsing isikuvormi väljal (ADR 0059): kliendipoolne,
 * sest register on väike ja otsing peab olema trükkimise ajal kohene.
 * Normaliseerimine kordab serverit (`registry_candidates._norm` + diakriitikuteta).
 */
export interface RegistryEntryLike {
  id: string | null;
  labels: Record<string, string>;
  variants: string[];
  place_key?: string | null;
  active_from?: number;
  active_to?: number;
}

export interface RegistryHit {
  key: string;
  entry: RegistryEntryLike;
  label: string;
  /** Tekst, mis sobis (silt või nimevariant). */
  matched: string;
}

export function normRegistryText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('et').replace(/\s+/g, ' ').trim();
}

export function registryLabel(entry: RegistryEntryLike, key: string, lang: string): string {
  return entry.labels[lang] || entry.labels.et || entry.labels.en || key;
}

/** Vasted järjestuses: täpne > algab > sisaldab; sama taseme sees sildi järgi. */
export function matchRegistry(registry: Record<string, RegistryEntryLike>, query: string,
  lang: string, limit = 6): RegistryHit[] {
  const q = normRegistryText(query);
  if (q.length < 2) return [];
  const hits: (RegistryHit & { rank: number })[] = [];
  for (const [key, entry] of Object.entries(registry)) {
    const texts = [...Object.values(entry.labels), ...entry.variants, key];
    let best: { rank: number; text: string } | null = null;
    for (const text of texts) {
      const n = normRegistryText(text);
      const rank = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : -1;
      if (rank >= 0 && (!best || rank < best.rank)) best = { rank, text };
    }
    if (best) hits.push({ key, entry, label: registryLabel(entry, key, lang), matched: best.text, rank: best.rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, lang));
  return hits.slice(0, limit).map(({ rank: _rank, ...hit }) => hit);
}

/**
 * Sidumata välja kindel vaste registris: sama Q-kood või täpselt sama silt/nimevariant.
 * Ainult kindel vaste — osaline sõnavaste pakuks valet asutust (Tartu gümnaasium
 * 1630–1632 ≠ `gymn-dorpat` 1804–1890). Mitu kandidaati → null, valib inimene.
 */
export function registrySuggestion(registry: Record<string, RegistryEntryLike>, qid: string | null | undefined,
  text: string | null | undefined, lang: string): RegistryHit | null {
  const entries = Object.entries(registry);
  const hit = (key: string, entry: RegistryEntryLike, matched: string): RegistryHit =>
    ({ key, entry, label: registryLabel(entry, key, lang), matched });
  if (qid) {
    const byId = entries.filter(([, entry]) => entry.id === qid);
    // Q-koodiga väli seotakse ainult Q järgi: nimevaste Q-koodita kirjega kaotaks
    // sidumisel fakti Q-koodi (võtmega fakt võtab `id` registrist, ADR 0059).
    return byId.length === 1 ? hit(byId[0][0], byId[0][1], text || qid) : null;
  }
  const q = text ? normRegistryText(text) : '';
  if (!q) return null;
  const byText = entries.filter(([, entry]) =>
    [...Object.values(entry.labels), ...entry.variants].some(value => normRegistryText(value) === q));
  return byText.length === 1 ? hit(byText[0][0], byText[0][1], text!) : null;
}

/**
 * Allika sõnastus pärast registrikirje valikut. Väli on korraga otsingukast ja
 * allika kuju, seega trükitud pooliku päringu („Upps") ei tohi saada allika kujuks.
 * - trükitud tekst on registri silt või nimevariant → see on päris allika kuju;
 * - muidu jääb varasem allika kuju;
 * - tühjal real registri silt.
 */
export function sourceFormAfterPick(previous: string, typed: string, hit: RegistryHit): string {
  const t = normRegistryText(typed);
  const known = [...Object.values(hit.entry.labels), ...hit.entry.variants];
  const exact = known.find(text => normRegistryText(text) === t);
  if (t && exact) return typed.trim();
  return previous.trim() || hit.label;
}
