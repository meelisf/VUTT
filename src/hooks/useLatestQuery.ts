import { useCallback, useEffect, useRef, useState } from 'react';

/** Päring, mille tulemus kuulub ALATI viimasele võtmele (#421, #425).
 *
 * `key` kodeerib päringu KÕIK parameetrid (nt `JSON.stringify(params)`); uus
 * päring tehakse ainult võtme, ulatuse või `reload`-i peale. Nii ei saa ükski
 * filter sõltuvuste loendist välja jääda — `originPlace` jäi käsitsi loendist
 * välja ja päritolukoha vahetus ei käivitanud päringut.
 *
 * Vanema päringu vastus, viga ja lõpp ei muuda olekut: iga olekukirje kannab
 * selle päringu id-d, mille järel ta tekkis, ja laadimine on TULETATUD
 * („aktiivne id ≠ viimati lõppenud id"), mitte eraldi lipp, mida vana päringu
 * `finally` saaks maha võtta.
 *
 * `scope` on ligipääsu-/kollektsiooniulatus. Teise ulatuse andmeid ei tagastata:
 * ulatuse vahetus on esmalaadimine, mitte uuendamine, sest vana ulatuse
 * tulemused ei pruugi uues üldse nähtavad olla.
 *
 * `key = null` keelab päringu (nt kaardivaade); lennus olev vastus jäetakse
 * kõrvale. Võrgupäringut ei katkestata — teenusekiht ei toeta signaali. */
export function useLatestQuery<T>(
  key: string | null,
  scope: string,
  fetcher: () => Promise<T>,
) {
  const fetcherRef = useRef(fetcher);
  // Deklareeritud enne päringu-effecti, seega jookseb enne teda.
  useEffect(() => { fetcherRef.current = fetcher; });

  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{
    data?: T;
    dataScope?: string;
    settledId: string | null;
    error: unknown;
  }>({ settledId: null, error: null });

  const requestId = key === null ? null : JSON.stringify([key, scope, tick]);

  useEffect(() => {
    if (requestId === null) return;
    let active = true;
    fetcherRef.current().then(
      data => { if (active) setState({ data, dataScope: scope, settledId: requestId, error: null }); },
      error => { if (active) setState(s => ({ ...s, settledId: requestId, error })); },
    );
    return () => { active = false; };
  }, [requestId, scope]);

  const reload = useCallback(() => setTick(n => n + 1), []);

  const pending = requestId !== null && state.settledId !== requestId;
  const data = state.dataScope === scope ? state.data : undefined;
  const error = !pending && state.settledId === requestId ? state.error : null;

  return {
    data,
    error,
    initialLoading: pending && data === undefined,
    refreshing: pending && data !== undefined,
    reload,
  };
}
