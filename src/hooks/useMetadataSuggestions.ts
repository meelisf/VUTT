import { useState, useEffect } from 'react';
import { FILE_API_URL } from '../config';
import { apiPost } from '../services/apiClient';
import { useUser } from '../contexts/UserContext';

interface SuggestionItem {
  label: string;
  id: string | null;
}

/**
 * Laadib metaandmete soovitused serverist.
 * Kasutatakse BulkGenrePicker ja BulkTagsPicker komponentides.
 *
 * @param isOpen - kas modal on avatud (trigger laadimisele)
 * @param lang - praegune keel
 * @param field - milliseid soovitusi tahame: 'genres' | 'tags'
 */
export function useMetadataSuggestions(
  isOpen: boolean,
  lang: string,
  field: 'genres' | 'tags'
): { suggestions: SuggestionItem[]; isLoadingSuggestions: boolean } {
  const { authToken } = useUser();
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const load = async () => {
      setIsLoadingSuggestions(true);
      try {
        const result = await apiPost<any>(`${FILE_API_URL}/get-metadata-suggestions`, { lang }, { token: authToken });
        if (!cancelled && result.status === 'success') {
          setSuggestions(result[field] || []);
        }
      } catch (e) {
        if (!cancelled) console.error('Failed to load suggestions:', e);
      } finally {
        if (!cancelled) setIsLoadingSuggestions(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [isOpen, lang, field, authToken]);

  return { suggestions, isLoadingSuggestions };
}
