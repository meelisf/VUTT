import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCollection } from '../contexts/CollectionContext';
import {
  parseSelection,
  readSelectionToken,
  serializeSelection,
  writeSelectionToken,
} from '../contexts/collectionUrl';
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
 *
 * Töökollektsioon (#354) käib SAMA otsustaja kaudu ühe tokenina
 * (`all` | `<kogu-id>` | `s:<kogu-id>`) — teist efekti `?set=` jaoks ei lisata.
 * Token kirjutatakse õigesse parameetrisse ja teine eemaldatakse, nii et
 * URL-ist loetud token on alati identne sellega, mille me kirjutasime.
 */
export function useCollectionUrlSync(): void {
  const { selection, setSelection, collections, workSets, isLoading } = useCollection();
  // Ainult AKTIIVSED kogud on adopteeritavad: arhiveeritud kogu link ei tohi
  // vaadet vaikselt arhiivi viia.
  const knownSets = useMemo(
    () => new Set(workSets.filter(ws => ws.status === 'active').map(ws => ws.id)),
    [workSets],
  );
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
    const urlValue = readSelectionToken(searchParams);
    const action = decideCollectionSync(
      urlValue, serializeSelection(selection), agreed.current, mirrored.current,
      collections, knownSets,
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
      setSelection(parseSelection(action.value));
      return;
    }
    agreed.current = action.value;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        writeSelectionToken(next, action.value);
        if (action.resetPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [selection, setSelection, collections, knownSets, isLoading, searchParams, setSearchParams]);
}
