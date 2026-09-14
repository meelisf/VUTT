/**
 * Kogude haldusloendi read (#318, spekk §4).
 *
 * Kaks andmemudelit — hierarhilised kollektsioonid (`collections.json`) ja
 * lamedad töökollektsioonid (`work_sets/{id}.json`) — EI OLE liidetud. Siin
 * tehakse neist ainult ühine KUVAMISE reaploend; kuuluvus, õigused ja
 * salvestus jäävad kumbki oma teele.
 *
 * Otsing lamendab hierarhia meelega: kui vaste vanemat ei kuvata, ripuks
 * taandega rida tühjas õhus.
 */
import { normalizeForSearch } from '../../utils/diacritics';
import { Collections } from '../../services/collectionService';
import { WorkSetSummary } from '../../services/workSetService';

export type KoguTyyp = 'all' | 'collections' | 'work_sets';

export interface KoguRida {
  kind: 'collection' | 'work_set';
  id: string;
  name: string;
  /** Taandetase hierarhias; otsingu ajal alati 0. */
  depth: number;
  /** Kollektsioonil: virtuaalne rühm. Töökollektsioonil: alati false. */
  isVirtual: boolean;
  /** Kollektsioonil: piiratud nähtavus. Töökollektsioonil: alati false. */
  restricted: boolean;
  /** Töökollektsioonil: arhiveeritud. Kollektsioonil: alati false. */
  archived: boolean;
}

export interface KoguFilter {
  tyyp: KoguTyyp;
  q: string;
}

/** URL → tüüp. Tundmatu väärtus tähendab „kõik", mitte tühja loendit. */
export function tyypFromParam(p: string | null): KoguTyyp {
  return p === 'collections' || p === 'work_sets' ? p : 'all';
}

/** Tüüp → URL. Vaikimisi „kõik" ei lähe URL-i, et link jääks puhtaks. */
export function paramFromTyyp(t: KoguTyyp): Record<string, string> {
  return t === 'all' ? {} : { type: t };
}

function kogudeRead(
  collections: Collections, lang: 'et' | 'en', flat: boolean,
): KoguRida[] {
  const nimi = (id: string) =>
    collections[id]?.name?.[lang] || collections[id]?.name?.et || id;

  const rida = (id: string, depth: number): KoguRida => ({
    kind: 'collection',
    id,
    name: nimi(id),
    depth,
    isVirtual: collections[id]?.type === 'virtual_group',
    restricted: collections[id]?.visibility === 'restricted',
    archived: false,
  });

  const koik = Object.keys(collections);
  if (flat) {
    return koik.map(id => rida(id, 0))
      .sort((a, b) => a.name.localeCompare(b.name, 'et'));
  }

  // Hierarhia: juured nime järgi, iga vanema järel tema lapsed.
  const lapsed = (parent: string | undefined) => koik
    .filter(id => (collections[id]?.parent || undefined) === parent)
    .sort((a, b) => nimi(a).localeCompare(nimi(b), 'et'));

  const out: KoguRida[] = [];
  const lisa = (id: string, depth: number) => {
    out.push(rida(id, depth));
    // Sügavuse lagi 10: katkine `parent`-ahel (kogu viitab iseendale või
    // ringi) ei tohi lehte külmutada.
    if (depth < 10) lapsed(id).forEach(alam => lisa(alam, depth + 1));
  };
  lapsed(undefined).forEach(id => lisa(id, 0));

  // Orvud (vanem on kustutatud) EI TOHI loendist kaduda — muidu ei saa neid
  // enam hallata. Need lähevad lõppu juuretasemele.
  const nahtud = new Set(out.map(r => r.id));
  koik.filter(id => !nahtud.has(id)).forEach(id => out.push(rida(id, 0)));
  return out;
}

function kogumiteRead(sets: WorkSetSummary[], lang: 'et' | 'en'): KoguRida[] {
  return sets.map(ws => ({
    kind: 'work_set' as const,
    id: ws.id,
    name: ws.name?.[lang] || ws.name?.et || ws.name?.en || ws.id,
    depth: 0,
    isVirtual: false,
    restricted: false,
    archived: ws.status === 'archived',
  })).sort((a, b) => a.name.localeCompare(b.name, 'et'));
}

export function buildKoguRows(
  collections: Collections,
  workSets: WorkSetSummary[],
  filter: KoguFilter,
  lang: 'et' | 'en',
): KoguRida[] {
  const q = normalizeForSearch(filter.q);
  const otsib = q !== '';

  const read: KoguRida[] = [];
  if (filter.tyyp !== 'work_sets') read.push(...kogudeRead(collections, lang, otsib));
  if (filter.tyyp !== 'collections') read.push(...kogumiteRead(workSets, lang));

  if (!otsib) return read;
  return read.filter(r => normalizeForSearch(r.name).includes(q)
    || normalizeForSearch(r.id).includes(q));
}
