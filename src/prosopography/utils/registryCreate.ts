// src/prosopography/utils/registryCreate.ts
/**
 * Uue ameti- või asutusekirje koostamine (ADR 0059): Wikidata kirjest mustand,
 * kontroll olemasoleva registri vastu ja võtme eelvaade. Puhas, side-effect-vaba.
 * Võtme lõplik valik on serveris (`registries.generate_key`) — siin ainult eelvaade.
 */
import { normRegistryText, registryLabel, type RegistryEntryLike } from './registryMatch';

export type RegistryKind = 'occupation' | 'institution';

export interface RegistryDraft {
  id: string | null;
  labels: Record<string, string>;
  variants: string[];
  /** Wikidata kirjeldus — ainult kuvamiseks, registrisse ei lähe. */
  description?: string;
  type?: string;
  place_key?: string | null;
  active_from?: number;
  active_to?: number;
  notes?: string;
}

const LABEL_LANGS = ['et', 'en', 'de', 'la', 'sv'] as const;

/** Wikidata P31 → asutuse liik registris. Tundmatu jääb tühjaks, valib inimene. */
const INSTANCE_TYPES: Record<string, string> = {
  Q3918: 'university', Q875538: 'university', Q1767829: 'university',
  Q55043: 'gymnasium', Q159334: 'gymnasium',
  Q3914: 'school', Q9842: 'school', Q9826: 'school',
  Q102496: 'parish',
};

function claimIds(entity: any, prop: string): string[] {
  return (entity?.claims?.[prop] ?? [])
    .map((c: any) => c?.mainsnak?.datavalue?.value?.id)
    .filter((id: unknown): id is string => typeof id === 'string');
}

/** Wikidata ajaväärtus „+1630-00-00T00:00:00Z" → 1630; eKr ja täpsuseta → undefined. */
function claimYear(entity: any, prop: string): number | undefined {
  for (const claim of entity?.claims?.[prop] ?? []) {
    const time = claim?.mainsnak?.datavalue?.value?.time;
    const m = typeof time === 'string' ? /^\+(\d{4})-/.exec(time) : null;
    if (m) return Number(m[1]);
  }
  return undefined;
}

/**
 * Wikidata kirje → registri mustand. Koht seotakse ainult siis, kui kohtade registris
 * on TÄPSELT üks sama Q-koodiga koht (P131 haldusüksus, P276 asukoht, P159 peakorter).
 */
export function entityToRegistryDraft(entity: any, kind: RegistryKind,
  places: Record<string, { id?: string | null }>): RegistryDraft {
  const labels: Record<string, string> = {};
  for (const lang of LABEL_LANGS) {
    const value = entity?.labels?.[lang]?.value;
    if (value) labels[lang] = value;
  }
  const kept = new Set(Object.values(labels).map(normRegistryText));
  const variants: string[] = [];
  for (const lang of LABEL_LANGS) {
    for (const alias of entity?.aliases?.[lang] ?? []) {
      const value = alias?.value;
      if (value && !kept.has(normRegistryText(value))) { variants.push(value); kept.add(normRegistryText(value)); }
    }
  }
  const description = entity?.descriptions?.et?.value ?? entity?.descriptions?.en?.value;
  const draft: RegistryDraft = { id: entity?.id ?? null, labels, variants, description };
  if (kind === 'institution') {
    draft.type = claimIds(entity, 'P31').map(q => INSTANCE_TYPES[q]).find(Boolean) ?? '';
    const locationIds = [...claimIds(entity, 'P276'), ...claimIds(entity, 'P131'), ...claimIds(entity, 'P159')];
    for (const qid of locationIds) {
      const hits = Object.entries(places).filter(([, place]) => place.id === qid);
      if (hits.length === 1) { draft.place_key = hits[0][0]; break; }
    }
    const from = claimYear(entity, 'P571');
    const to = claimYear(entity, 'P576');
    if (from !== undefined) draft.active_from = from;
    if (to !== undefined && (from === undefined || to >= from)) draft.active_to = to;
  }
  return draft;
}

export function formatYears(from?: number | null, to?: number | null): string {
  if (from == null && to == null) return '';
  if (from != null && to == null) return `${from}–`;
  return `${from ?? ''}–${to ?? ''}`;
}

/** „1630–1632", „1630–", „–1632", „1630" → aastad; tühi → {}; vigane → null. */
export function parseYears(text: string): { active_from?: number; active_to?: number } | null {
  const value = text.trim();
  if (!value) return {};
  const m = /^(\d{4})?\s*(?:([-–])\s*(\d{4})?)?$/.exec(value);
  if (!m || (!m[1] && !m[3])) return null;
  const from = m[1] ? Number(m[1]) : undefined;
  const to = m[3] ? Number(m[3]) : (m[2] ? undefined : from);
  if (from !== undefined && to !== undefined && from > to) return null;
  return { ...(from !== undefined ? { active_from: from } : {}), ...(to !== undefined ? { active_to: to } : {}) };
}

/** Kordab serveri `_slug`-i ja `generate_key`-d eelvaateks. */
export function slugKey(text: string): string {
  return text.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

export function previewKey(registry: Record<string, unknown>, draft: RegistryDraft): string {
  const base = slugKey(draft.labels.et || draft.labels.en || Object.values(draft.labels)[0] || '') || 'kirje';
  const candidates = [base, ...(draft.active_from !== undefined ? [`${base}-${draft.active_from}`] : [])];
  const free = candidates.find(candidate => !(candidate in registry));
  if (free) return free;
  const last = candidates[candidates.length - 1];
  let n = 2;
  while (`${last}-${n}` in registry) n++;
  return `${last}-${n}`;
}

/** Sama Q-koodiga olemasolev kirje — uut ei looda, kasutatakse seda. */
export function sameIdEntry(registry: Record<string, RegistryEntryLike>, qid: string | null | undefined): string | null {
  if (!qid) return null;
  return Object.entries(registry).find(([, entry]) => entry.id === qid)?.[0] ?? null;
}

export interface SimilarEntry { key: string; label: string; entry: RegistryEntryLike; }

/**
 * Sarnase nimega kirjed (sama Q-kood on eraldi, `sameIdEntry`): mustandi mõni nimi
 * ühtib registri sildi või nimevariandiga või sisaldab seda (≥ 6 tähte). Need peab
 * inimene üle vaatama — „Tartu gümnaasium" 1630 ja „Tartu Gümnaasium" 1804 on eri asutused.
 */
export function similarEntries(registry: Record<string, RegistryEntryLike>, draft: RegistryDraft,
  lang: string): SimilarEntry[] {
  const names = [...Object.values(draft.labels), ...draft.variants].map(normRegistryText).filter(Boolean);
  if (!names.length) return [];
  const out: SimilarEntry[] = [];
  for (const [key, entry] of Object.entries(registry)) {
    if (draft.id && entry.id === draft.id) continue;
    const theirs = [...Object.values(entry.labels), ...entry.variants].map(normRegistryText).filter(Boolean);
    const close = names.some(a => theirs.some(b => a === b
      || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a)))));
    if (close) out.push({ key, label: registryLabel(entry, key, lang), entry });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, lang));
}
