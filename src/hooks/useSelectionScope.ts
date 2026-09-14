/**
 * Aktiivse valiku muutmine otsingufiltri ulatuseks (#354).
 *
 * Töökollektsiooni korral tuleb ID-loend serverilt (liikmesust ei indekseerita,
 * ADR 0042). Kuni loend ei ole kohal, on `ready` väär ja kutsuja EI TOHI
 * päringut teha: piiramata päring näitaks teoseid väljaspool valikut.
 */
import { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../contexts/CollectionContext';
import { CollectionSelection, SelectionScope } from '../services/selectionFilter';
import { getWorkSetWorkIds } from '../services/workSetService';

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
  const { selection } = useCollection();
  const [workSetIds, setWorkSetIds] = useState<string[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Eraldi muutuja, mitte tingimuslik avaldis sõltuvusmassiivis: viimast ei
  // oska ESLint kontrollida ja vale sõltuvus siin tähendaks vale kogu ID-loendit.
  const setId = selection.kind === 'work_set' ? selection.id : null;

  useEffect(() => {
    if (setId === null) {
      setWorkSetIds(null);
      setError(null);
      return;
    }
    let tyhistatud = false;
    // Valiku vahetus nullib loendi: vana kogu ID-d ei tohi hetkekski uue
    // kogu filtriks minna.
    setWorkSetIds(null);
    setError(null);
    getWorkSetWorkIds(setId)
      .then(ids => { if (!tyhistatud) setWorkSetIds(ids); })
      .catch(e => {
        // 403/404: ligipääs kadus või kogu kustutati. Viga on NÄHTAV, mitte
        // vaikne tühi vaade — kasutaja peab teadma, miks ta midagi ei näe.
        if (!tyhistatud) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => { tyhistatud = true; };
  }, [setId]);

  // Memoiseerimine on KOHUSTUSLIK, mitte optimeerimine: `scope` läheb kutsujate
  // useEffect-sõltuvusse ja uus objekt igal renderdusel annaks lõputu
  // päringutsükli.
  return useMemo(() => {
    const state = selectionScopeFrom(selection, workSetIds);
    return error ? { ...state, ready: false, error } : state;
  }, [selection, workSetIds, error]);
}
