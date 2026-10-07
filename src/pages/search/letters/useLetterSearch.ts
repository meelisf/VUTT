import { useEffect, useState } from 'react';
import { useMeiliLettersIndex } from '../../../contexts/MeilisearchContext';
import { LetterFilters, LetterSearchResult, searchLetters } from '../../../services/letterSearch';
import type { SelectionScope } from '../../../services/selectionFilter';

/**
 * Kirjaotsingu päring. Kuni valiku ulatus pole valmis (töökollektsiooni
 * ID-loend laeb), päringut EI tehta — piiramata päring näitaks kirju
 * väljaspool valikut (ADR 0042).
 */
export function useLetterSearch(
  query: string,
  filters: LetterFilters,
  page: number,
  scope: SelectionScope | undefined,
  scopeReady: boolean,
) {
  const index = useMeiliLettersIndex();
  const [result, setResult] = useState<LetterSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Filtrite objekt luuakse URL-ist igal renderdusel → sõltuvuseks stabiilne võti.
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!index || !scopeReady) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchLetters(index, query, JSON.parse(filtersKey) as LetterFilters, scope, page)
      .then(r => { if (!cancelled) setResult(r); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [index, query, filtersKey, page, scope, scopeReady]);

  return { result, loading, error };
}
