// „Kelle kohta" isikud (#743): andmed jäävad teose `tags[]`-i — server annab neile
// `subject`-rolli (`indices.metadata_entries`) ja asendab välise ID VUTT-i kaardiga
// (`ensure_prosopo_stubs`). Siin on ainult vaate jaotus ja vastuvõtureegel.
import type { LinkedEntity } from '../../types/LinkedEntity';

const EXTERNAL_SOURCES = new Set(['wikidata', 'gnd', 'viaf']);

/** Märksõna on „Kelle kohta" isik: ID-ga ja kas VUTT-i isik või isikuks märgitud. */
export function isSubjectPerson(tag: string | LinkedEntity): boolean {
  if (typeof tag === 'string' || !tag.id) return false;
  return tag.id.startsWith('vutt:P') || tag.entity_type === 'person';
}

/**
 * Valija tulemus → „Kelle kohta" kirje või `null`, kui seda ei saa isikuga siduda.
 * Vabatekstiline nimi ei kõlba: ta ei jõuaks isikulehele ega võrgustikku.
 */
export function acceptSubjectPerson(val: LinkedEntity | null): LinkedEntity | null {
  if (!val?.id) return null;
  const vutt = val.id.startsWith('vutt:P');
  if (!vutt && !EXTERNAL_SOURCES.has((val.source || '').toLowerCase())) return null;
  return { ...val, entity_type: 'person' };
}
