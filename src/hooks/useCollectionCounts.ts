import { useEffect, useState } from 'react';
import type { Index } from 'meilisearch';
import { useMeilisearch } from '../contexts/MeilisearchContext';
import { CollectionCounts, getCollectionCounts } from '../services/searchService';

/**
 * Püsikogude teoste arvud (#587). Valija ja kogu-riba jagavad ÜHT päringut.
 *
 * Võti on `Index`-objekt: tokeni vahetus (sisse-/väljalogimine) annab uue
 * objekti ja seega uue päringu — ühe kasutaja arvud ei jää teisele. Vahemälu
 * elab ainult brauseris, mitte `server/cache.py`-s (ADR 0042: arv sõltub
 * kutsujast). Värskeneb lehe uuel laadimisel; arvud muutuvad harva.
 */
const vahemalu = new WeakMap<Index, Promise<CollectionCounts>>();

function fetchCounts(index: Index): Promise<CollectionCounts> {
  let p = vahemalu.get(index);
  if (!p) {
    p = getCollectionCounts(index);
    // Viga ei jää vahemällu — järgmine tarbija proovib uuesti.
    p.catch(() => vahemalu.delete(index));
    vahemalu.set(index, p);
  }
  return p;
}

/** `null` = veel laadimata või päring ebaõnnestus: arvu asemel ei näidata midagi. */
export function useCollectionCounts(): CollectionCounts | null {
  const { index } = useMeilisearch();
  const [counts, setCounts] = useState<{ index: Index; value: CollectionCounts } | null>(null);

  useEffect(() => {
    if (!index) return;
    let tyhistatud = false;
    fetchCounts(index)
      .then(value => { if (!tyhistatud) setCounts({ index, value }); })
      .catch(e => console.warn('Kogude arvude laadimine ebaõnnestus', e));
    return () => { tyhistatud = true; };
  }, [index]);

  // Eelmise tokeni arvud ei kehti uue tokeniga.
  return counts && counts.index === index ? counts.value : null;
}
