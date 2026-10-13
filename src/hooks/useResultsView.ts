import { useCallback, useState } from 'react';
import { useUser, type ResultsPage, type ResultsView } from '../contexts/UserContext';

const storageKey = (page: ResultsPage) => `vutt_results_view_${page}`;

const readLocal = (page: ResultsPage): ResultsView | null => {
  try {
    const v = localStorage.getItem(storageKey(page));
    return v === 'list' || v === 'cards' ? v : null;
  } catch { return null; }
};

/**
 * Kaardid ↔ loend lehe kaupa (#587). Brauser mäletab alati (ka sisse logimata);
 * sisseloginud kasutajal läheb valik ka serveri seadetesse ja tuleb teise seadmesse
 * kaasa. Serveri väärtus võidab, kui ta on olemas.
 */
export function useResultsView(page: ResultsPage): [ResultsView, (next: ResultsView) => void] {
  const { user, userSettings, updateSettings } = useUser();
  const [local, setLocal] = useState<ResultsView | null>(() => readLocal(page));
  const server = user ? userSettings.results_view?.[page] : undefined;
  const view: ResultsView = server ?? local ?? 'cards';

  const setView = useCallback((next: ResultsView) => {
    setLocal(next);
    try { localStorage.setItem(storageKey(page), next); } catch { /* privaatne aken */ }
    // Server liidab lehed ise kokku; liidame ka siin, sest `updateSettings`
    // asendab kliendi olekus ülemise taseme võtme tervikuna
    if (user) void updateSettings({ results_view: { ...userSettings.results_view, [page]: next } });
  }, [page, user, userSettings.results_view, updateSettings]);

  return [view, setView];
}
