import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCollection } from '../contexts/CollectionContext';
import { COLLECTION_PARAM } from '../contexts/collectionUrl';
import { decideCollectionSync } from '../contexts/collectionSync';

/**
 * Hoiab aktiivse kogu URL-i ja konteksti kooskõlas — MÕLEMAS suunas.
 *
 * Kogu peab URL-is alati olema, muidu kannab jagatud link küll filtrid, aga
 * rakendab need saaja kogus ja annab tihti null vastet (#323).
 *
 * Suuna valib `decideCollectionSync`, mitte see hook. Varem elas vastassuund
 * eraldi effectina Dashboardis ja Statistikas; kaks peeglit teineteise vastas
 * andsid lõputu URL-i vahetuse (#333). Ainus omanik on nüüd siin.
 */
export function useCollectionUrlSync(): void {
  const { selectedCollection, setSelectedCollection, collections, isLoading } = useCollection();
  const [searchParams, setSearchParams] = useSearchParams();
  // Viimane väärtus, milles URL ja kontekst kokku leppisid. Selle järgi
  // eristab otsustaja „kontekst liikus" olukorra „URL liikus väljastpoolt"
  // omast — ilma selleta ei ole lahknemise põhjus loetav.
  const agreed = useRef<string | null>(null);
  // Esimene kirjutus on olemasoleva vaate PEEGELDUS, edasised on VAHETUS.
  // Ainult vahetus tohib lehe 1-le lähtestada — muidu kaotaks `?page=3`-ga
  // saabunud link oma lehe kohe avamisel.
  const mirrored = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    const urlValue = searchParams.get(COLLECTION_PARAM);
    const action = decideCollectionSync(
      urlValue, selectedCollection, agreed.current, mirrored.current, collections,
    );
    mirrored.current = true;

    if (action.type === 'noop') {
      agreed.current = urlValue;
      return;
    }
    if (action.type === 'adopt-url') {
      // Omaksvõtt EI kirjuta URL-i: lahknemine lõpeb ühe sammuga ja jagatud
      // lingi ülejäänud parameetrid (`page`, filtrid) jäävad puutumata.
      agreed.current = urlValue;
      setSelectedCollection(action.value);
      return;
    }
    agreed.current = action.value;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(COLLECTION_PARAM, action.value);
        if (action.resetPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [selectedCollection, setSelectedCollection, collections, isLoading, searchParams, setSearchParams]);
}
