import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCollection } from '../contexts/CollectionContext';
import { ALL_COLLECTIONS, COLLECTION_PARAM } from '../contexts/collectionUrl';

/**
 * Hoiab aktiivse kogu URL-is (Context → URL; vastassuund on
 * `CollectionContext` init + Dashboardi/Statistika effect).
 *
 * Varem kirjutas see parameetri ainult siis, kui kogu VAHETUS. Kes oma kogus
 * juba oli ja lihtsalt filtreeris, sai aadressiribalt lingi ilma koguta —
 * ja saajal rakendusid filtrid tema enda kogus, tihti null vastet (#323).
 * Nüüd on parameeter olemas alati, kui kogu on teada.
 *
 * `null` kirjutatakse sõnaselgelt `all`-ina: puuduv parameeter tähendab
 * „ei ütle midagi" ja saaja langeks tagasi oma valikule.
 */
export function useCollectionUrlSync(): void {
  const { selectedCollection, isLoading } = useCollection();
  const [searchParams, setSearchParams] = useSearchParams();
  // Esimene kirjutus on olemasoleva vaate PEEGELDUS, edasised on VAHETUS.
  // Ainult vahetus tohib lehe 1-le lähtestada — muidu kaotaks `?page=3`-ga
  // saabunud link oma lehe kohe avamisel.
  const mirrored = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    const want = selectedCollection ?? ALL_COLLECTIONS;
    if (searchParams.get(COLLECTION_PARAM) === want) {
      mirrored.current = true;
      return;
    }
    const isSwitch = mirrored.current;
    mirrored.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(COLLECTION_PARAM, want);
        if (isSwitch) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [selectedCollection, isLoading, searchParams, setSearchParams]);
}
