import { useEffect, useRef } from 'react';
import { SetURLSearchParams } from 'react-router-dom';

/**
 * Sünkroonib valitud kollektsiooni URL-i ?collection= parameetriga.
 * Context → URL suund (vastupidine: URL → Context toimub Dashboard.tsx-is).
 *
 * Jätab vahele esialgse laadimise (null → vaikimisi kollektsioon),
 * et mitte kirjutada üle otselingi ?collection= parameetrit.
 */
export function useCollectionUrlSync(
  selectedCollection: string | null,
  setSearchParams: SetURLSearchParams
): void {
  // Jälgib, kas kontekst on esmakordselt laetud (null → non-null üleminek)
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      if (selectedCollection !== null) {
        // Kontekst on laetud — järgmised muutused uuendavad URL-i
        initialized.current = true;
      }
      // Laadimise ajal URL-i ei muuda
      return;
    }

    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (selectedCollection) {
        next.set('collection', selectedCollection);
      } else {
        next.delete('collection');
      }
      return next;
    }, { replace: true });
  }, [selectedCollection]);
}
