import type { PlaceEntry, ProsopoRecord } from '../types';

export function isWithinPlace(key: string, parent: string, places: Record<string, PlaceEntry>): boolean {
  const seen = new Set<string>();
  let current: string | null | undefined = key;
  while (current && !seen.has(current)) {
    if (current === parent) return true;
    seen.add(current);
    current = places[current]?.parent_key;
  }
  return false;
}

/** Prefer a registered finer place only when the register proves containment.
 * A name alone is never an identity or a containment claim. */
export function personOriginKey(person: ProsopoRecord, places: Record<string, PlaceEntry>): string {
  const origin = person.origin?.place || '';
  const qid = person.birth?.place?.id;
  const birth = qid ? Object.keys(places).find(key => places[key].id === qid) : undefined;
  if (!birth) return origin;
  if (!origin || isWithinPlace(birth, origin, places)) return birth;
  return origin;
}

export function legacyBirthNote(person: ProsopoRecord, key: string, places: Record<string, PlaceEntry>): string {
  const birth = person.birth?.place;
  if (!birth?.label || !key || (birth.id && (places[key]?.id === birth.id || (person.origin?.place === key && person.origin?.place_id === birth.id)))) return '';
  const birthKey = birth.id ? Object.keys(places).find(k => places[k].id === birth.id) : undefined;
  if (birthKey && (isWithinPlace(key, birthKey, places) || isWithinPlace(birthKey, key, places))) return '';
  return `Varasem sünnikoht: ${birth.label}${birth.id ? ` (${birth.id})` : ''}`;
}
