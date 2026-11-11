/**
 * Aktiivse valiku muutmine otsingufiltri ulatuseks (#354).
 *
 * Töökollektsiooni korral tuleb ID-loend serverilt (liikmesust ei indekseerita,
 * ADR 0042). Kuni loend ei ole kohal, on `ready` väär ja kutsuja EI TOHI
 * päringut teha: piiramata päring näitaks teoseid väljaspool valikut.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCollection } from '../contexts/CollectionContext';
import { useUser } from '../contexts/UserContext';
import { ApiError } from '../services/apiClient';
import { CollectionSelection, SelectionScope } from '../services/selectionFilter';
import { getWorkSetWorkIds, invalidateWorkSetIds } from '../services/workSetService';
import { isSessionExpired } from '../utils/apiErrorText';

export interface SelectionScopeState {
  /** `undefined` = piiramata (kõik teosed). */
  scope: SelectionScope | undefined;
  /** Kas ulatus on kasutatav? Väär ainult töökollektsiooni loendi laadimise ajal. */
  ready: boolean;
  error: Error | null;
}

/** Puhas kaardistus — ühikkatte jaoks eraldi funktsioonis. */
export function selectionScopeFrom(
  selection: CollectionSelection,
  workSetIds: string[] | null,
): SelectionScopeState {
  if (selection.kind === 'all') return { scope: undefined, ready: true, error: null };
  if (selection.kind === 'collection') {
    return { scope: selection.id, ready: true, error: null };
  }
  if (workSetIds === null) return { scope: undefined, ready: false, error: null };
  return { scope: { selection, workSetIds }, ready: true, error: null };
}

export function useSelectionScope(): SelectionScopeState {
  const { t } = useTranslation(['common']);
  const { selection } = useCollection();
  const { authToken, isLoading: authLoading, sessionExpired } = useUser();
  const [workSetIds, setWorkSetIds] = useState<string[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Eraldi muutuja, mitte tingimuslik avaldis sõltuvusmassiivis: viimast ei
  // oska ESLint kontrollida ja vale sõltuvus siin tähendaks vale kogu ID-loendit.
  const setId = selection.kind === 'work_set' ? selection.id : null;
  const eelmineToken = useRef<string | null>(authToken);

  useEffect(() => {
    if (setId === null) {
      setWorkSetIds(null);
      setError(null);
      return;
    }
    // Valiku vahetus nullib loendi: vana kogu ID-d ei tohi hetkekski uue
    // kogu filtriks minna.
    setWorkSetIds(null);
    setError(null);
    // Taastatav token pole veel kontrollitud: anonüümne päring annaks
    // privaatsele kogule 404 ja vilgutaks „ligipääs kadus" teadet.
    if (authLoading) return;
    // Surnud sessioon EI OLE anonüümne kasutaja: anonüümne kordus annaks 404
    // ja kasutaja näeks „ligipääs kadus" teadet, kuigi tal on vaja ainult
    // uuesti sisse logida. Uus sisselogimine muudab tokenit → kordus.
    if (!authToken && sessionExpired) {
      setError(new ApiError('session expired', 401));
      return;
    }
    // Kutsuja vahetus: vana kasutaja ID-loend ei tohi uuele jääda. Lapse
    // effect jookseb enne CollectionContexti oma, seega ei piisa sealsest
    // tühjendusest.
    if (eelmineToken.current !== authToken) {
      eelmineToken.current = authToken;
      invalidateWorkSetIds(setId);
    }
    let tyhistatud = false;
    getWorkSetWorkIds(setId)
      .then(ids => { if (!tyhistatud) setWorkSetIds(ids); })
      .catch(e => {
        // 403/404: ligipääs kadus või kogu kustutati. Viga on NÄHTAV, mitte
        // vaikne tühi vaade — kasutaja peab teadma, miks ta midagi ei näe.
        // 401: sessioon suri; apiClient on juba sisselogimise käivitanud.
        if (!tyhistatud) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => { tyhistatud = true; };
  }, [setId, authToken, authLoading, sessionExpired]);

  // Memoiseerimine on KOHUSTUSLIK, mitte optimeerimine: `scope` läheb kutsujate
  // useEffect-sõltuvusse ja uus objekt igal renderdusel annaks lõputu
  // päringutsükli.
  return useMemo(() => {
    const state = selectionScopeFrom(selection, workSetIds);
    if (!error) return state;
    // Sessiooni aegumine saab tõlgitud teksti siin, mitte serveri eestikeelse
    // sõnumina — vaated näitavad `error.message`-it otse.
    const shown = isSessionExpired(error)
      ? new ApiError(t('common:errors.sessionExpired'), 401)
      : error;
    return { ...state, ready: false, error: shown };
  }, [selection, workSetIds, error, t]);
}
