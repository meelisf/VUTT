/**
 * Isikuvalija lähteandmed väljaspool metaandmete modaali (teose osad #464):
 * kohalikud autorisoovitused + isikute register. Tõrge = tühjad loendid —
 * EntityPicker töötab ka ilma (otsib siis ainult välistest allikatest).
 */
import { useEffect, useState } from 'react';
import { FILE_API_URL } from '../config';
import { apiGet, apiPost } from '../services/apiClient';
import type { PeopleRegisterEntry } from '../components/EntityPicker';

interface SuggestionItem { label: string; id: string | null }

export function usePersonSources(token: string | null, lang: string) {
  const [authors, setAuthors] = useState<SuggestionItem[]>([]);
  const [peopleRegister, setPeopleRegister] = useState<PeopleRegisterEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiPost<any>(`${FILE_API_URL}/get-metadata-suggestions`, { lang }, { token });
        if (!cancelled && d.status === 'success') setAuthors(d.authors || []);
      } catch { /* soovitused on mugavus */ }
    })();
    (async () => {
      try {
        const d = await apiGet<any>(`${FILE_API_URL}/people-register`);
        if (!cancelled && d.status === 'success') setPeopleRegister(d.people || []);
      } catch { /* register on mugavus */ }
    })();
    return () => { cancelled = true; };
  }, [token, lang]);

  return { authors, peopleRegister };
}
