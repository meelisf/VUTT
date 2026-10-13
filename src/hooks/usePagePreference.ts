import { useCallback, useState } from 'react';
import { useUser, type ResultsPage, type UserSettings } from '../contexts/UserContext';

/** Lehe kaupa salvestatavad seaded (server liidab lehed kokku, vt `user_settings.py`). */
type PagePrefField = 'results_view' | 'filter_sidebar';
type PrefValue<F extends PagePrefField> = NonNullable<NonNullable<UserSettings[F]>[ResultsPage]>;

/**
 * Lehe kaupa eelistus (#587). Brauser mäletab alati (ka sisse logimata);
 * sisseloginud kasutajal läheb valik ka serveri seadetesse ja tuleb teise
 * seadmesse kaasa. Serveri väärtus võidab, kui ta on olemas.
 */
export function usePagePreference<F extends PagePrefField>(
  field: F,
  page: ResultsPage,
  parse: (raw: string | null) => PrefValue<F> | null,
  fallback: PrefValue<F>,
): [PrefValue<F>, (next: PrefValue<F>) => void] {
  const { user, userSettings, updateSettings } = useUser();
  const storageKey = `vutt_${field}_${page}`;
  const [local, setLocal] = useState<PrefValue<F> | null>(() => {
    try { return parse(localStorage.getItem(storageKey)); } catch { return null; }
  });
  const stored = userSettings[field] as Partial<Record<ResultsPage, PrefValue<F>>> | undefined;
  const server = user ? stored?.[page] : undefined;
  const value = server ?? local ?? fallback;

  const setValue = useCallback((next: PrefValue<F>) => {
    setLocal(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* privaatne aken */ }
    // Server liidab lehed ise kokku; liidame ka siin, sest `updateSettings`
    // asendab kliendi olekus ülemise taseme võtme tervikuna
    if (user) void updateSettings({ [field]: { ...stored, [page]: next } } as Partial<UserSettings>);
  }, [field, page, storageKey, user, stored, updateSettings]);

  return [value, setValue];
}
