/**
 * Kogu-valija kahe jaotise koostamine (#354).
 *
 * Puhas funktsioon, et otsingu ja filtreerimise reeglid oleksid testitavad
 * ilma komponenti renderdamata (projekti testimuster).
 */
import { CollectionTreeNode } from '../services/collectionService';
import { WorkSetSummary } from '../services/workSetService';

/** Kakskeelne nimi. Kumbki pool võib puududa — siis kasutatakse teist. */
export interface Nimi { et?: string; en?: string }

/** Nimevaste: valitud keel, siis teine keel — kogu võib olla nimetatud ühes. */
export function matchesQuery(name: Nimi, query: string, lang: 'et' | 'en'): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const kandidaadid = [name[lang], name.et, name.en].filter(Boolean) as string[];
  return kandidaadid.some(n => n.toLowerCase().includes(q));
}

/**
 * Vanema vaste hoiab KÕIK lapsed alles, lapse vaste hoiab vanema alles.
 * Muidu kaoks „Klingeriana" otsides tema ülemkogu ja tulemus rippuks õhus.
 */
function filterTree(
  nodes: CollectionTreeNode[], query: string, lang: 'et' | 'en',
): CollectionTreeNode[] {
  const out: CollectionTreeNode[] = [];
  for (const node of nodes) {
    if (matchesQuery(node.collection.name, query, lang)) {
      out.push(node);
      continue;
    }
    const children = filterTree(node.children, query, lang);
    if (children.length > 0) out.push({ ...node, children });
  }
  return out;
}

/**
 * Kogud, kuhu see kutsuja tohib teoseid LISADA.
 *
 * Kaks piirangut, mõlemad tahtlikud: vaataja ei saa lisada (`can_manage`), ja
 * arhiveeritud kogu ei võta uusi liikmeid — arhiveerimine tähendab „töö on
 * tehtud" ja vaikne lisandus sinna oleks üllatus.
 */
export function manageableWorkSets(
  workSets: WorkSetSummary[],
  query: string,
  lang: 'et' | 'en',
): WorkSetSummary[] {
  return sortWorkSets(
    workSets.filter(ws => ws.can_manage && ws.status === 'active'
      && matchesQuery(ws.name, query, lang)),
    lang,
  );
}

function sortWorkSets(sets: WorkSetSummary[], lang: 'et' | 'en'): WorkSetSummary[] {
  return [...sets].sort((a, b) => {
    const an = a.name[lang] || a.name.et || a.name.en || a.id;
    const bn = b.name[lang] || b.name.et || b.name.en || b.id;
    // Võrdse nime korral ID — järjestus peab olema täielik, muidu
    // hüppavad samanimelised kogud laadimiste vahel kohta.
    return an.localeCompare(bn, 'et') || a.id.localeCompare(b.id);
  });
}

export interface PickerEntries {
  permanent: CollectionTreeNode[];
  workSets: WorkSetSummary[];
}

export function buildPickerEntries(
  tree: CollectionTreeNode[],
  workSets: WorkSetSummary[],
  query: string,
  lang: 'et' | 'en',
): PickerEntries {
  return {
    permanent: filterTree(tree, query, lang),
    // Arhiveeritud kogu ei ole valitav: ta on ajalugu, mitte töökontekst.
    workSets: sortWorkSets(
      workSets.filter(ws => ws.status === 'active' && matchesQuery(ws.name, query, lang)),
      lang,
    ),
  };
}
