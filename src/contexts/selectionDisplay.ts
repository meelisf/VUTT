/**
 * Valiku KUVAND — üks tõene allikas (#354).
 *
 * Miks see fail olemas on: `selectedCollection` on `selection`-i kadudega vaade,
 * mis tagastab töökollektsiooni ajal `null` — aga `null` tähendab juba „kõik
 * teosed". Kaks eri olekut kollapseerusid üheks väärtuseks, ja iga kuvamiskoht
 * pidi kolmandat olekut ISE mäletama. Üks unustas (päis näitas töökollektsiooni
 * ajal „Kõik tööd").
 *
 * Nüüd on kuvandil üks allikas, nagu filtritel `scopeClauses`. i18n siin ei ela:
 * funktsioon annab FAKTI (mis on valitud ja kuidas ta nimi on), teksti valib vaade.
 */
import { Collections } from '../services/collectionService';
import { WorkSetSummary } from '../services/workSetService';
import { CollectionSelection } from '../services/selectionFilter';

export type SelectionDisplay =
  | { kind: 'all' }
  | { kind: 'collection'; id: string; name: string }
  /** `name: null` = kogu ei ole kutsujale nähtav (kustutatud või ligipääs kadus). */
  | { kind: 'work_set'; id: string; name: string | null };

export function selectionDisplay(
  selection: CollectionSelection,
  collections: Collections,
  workSets: WorkSetSummary[],
  lang: 'et' | 'en',
): SelectionDisplay {
  if (selection.kind === 'all') return { kind: 'all' };

  if (selection.kind === 'collection') {
    const c = collections[selection.id];
    // Tundmatu kogu kuvab id-d, mitte tühja stringi: tühi silt näeks välja
    // nagu „kõik teosed" ja peidaks katkise valiku.
    const name = c ? (c.name[lang] || c.name.et || selection.id) : selection.id;
    return { kind: 'collection', id: selection.id, name };
  }

  // Arhiveeritud kogu nimi kuvatakse ka: valik ise on aktiivne, ja nimeta
  // kuvand ei ütleks kasutajale, MIDA ta vaatab.
  const ws = workSets.find(w => w.id === selection.id);
  const name = ws ? (ws.name[lang] || ws.name.et || ws.name.en || ws.id) : null;
  return { kind: 'work_set', id: selection.id, name };
}
