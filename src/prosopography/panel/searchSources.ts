/**
 * Isikupaneeli otsing brauseris (lobid ei ole serverist alati kättesaadav).
 * Tulemus on viidete loend kandidaatide päringu jaoks; kukkunud allikas
 * märgitakse, et paneel saaks seda näidata (mitte vaikselt kaotada).
 *
 * `searchWikidata`/`searchGnd`/`searchViaf` neelavad vaikimisi oma vead ja
 * tagastavad `[]` (et EntityPicker jm olemasolevad kutsujad ei muutuks) —
 * seepärast kutsutakse siin kõiki kolme `throwOnError: true`-ga, muidu ei
 * jõuaks päris tõrge kunagi `Promise.allSettled`-ile `rejected`-ina.
 */
import { searchWikidata, searchWikidataPersonsFulltext } from '../../services/wikidataService';
import { searchGnd } from '../../services/gndService';
import { searchViaf } from '../../services/viafService';
import { normalizeExtId } from '../utils/externalIds';
import type { SourceRef, SourceScheme } from './types';

const _MAX_TOTAL = 15;

export async function searchPersonSources(
  query: string, lang: string,
  focusRef?: { scheme: SourceScheme; id: string },
): Promise<{ refs: SourceRef[]; failed: SourceScheme[] }> {
  const [wdKiire, wdTäis, gnd, viaf] = await Promise.allSettled([
    searchWikidata(query, lang, { throwOnError: true }), searchWikidataPersonsFulltext(query, lang),
    searchGnd(query, { throwOnError: true }), searchViaf(query, { throwOnError: true }),
  ]);
  const failed: SourceScheme[] = [];
  const wd = new Map<string, SourceRef>();
  // Täistekstiotsing (isik-ainult, I4) ees — kiirotsing toob ka mitte-isikuid,
  // mille dubleeriva ID puhul peab jääma peale isikuallika kirje.
  for (const res of [wdTäis, wdKiire]) {
    if (res.status !== 'fulfilled') continue;
    for (const x of res.value) {
      if (!wd.has(x.id)) wd.set(x.id, { scheme: 'wikidata', id: x.id, label: x.label, description: x.description });
    }
  }
  if (wdKiire.status === 'rejected' && wdTäis.status === 'rejected') failed.push('wikidata');
  const gndRefs: SourceRef[] = gnd.status === 'fulfilled'
    ? gnd.value.map(g => ({ scheme: 'gnd' as const, id: g.gndId, label: g.label, description: g.description }))
    : (failed.push('gnd'), []);
  const viafRefs: SourceRef[] = viaf.status === 'fulfilled'
    ? viaf.value.map(v => ({ scheme: 'viaf' as const, id: v.viafId, label: v.label, description: v.description }))
    : (failed.push('viaf'), []);
  const refs = [...[...wd.values()].slice(0, 7), ...gndRefs.slice(0, 4), ...viafRefs.slice(0, 4)];

  // focusRef (I3): valijast avatud viide ei tohi kaduda 4-liikmelisse GND/VIAF
  // lõikesse — kui teda otsingutulemustes ei ole, lisatakse ta esimeseks ja
  // ülejäänud kärbitakse lõpust, kogusumma jääb ikka ≤ 15.
  if (focusRef) {
    const norm = normalizeExtId(focusRef.scheme, focusRef.id);
    const already = refs.some(r => r.scheme === focusRef.scheme && normalizeExtId(r.scheme, r.id) === norm);
    if (!already) {
      refs.unshift({ scheme: focusRef.scheme, id: focusRef.id, label: focusRef.id });
      if (refs.length > _MAX_TOTAL) refs.length = _MAX_TOTAL;
    }
  }

  return { refs, failed };
}
