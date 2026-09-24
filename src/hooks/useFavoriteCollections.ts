/**
 * Lemmikkogud — kasutaja seade `favorite_collections` (serveris, liigub seadmete vahel).
 *
 * Tärni lülitamine on keelatud, kuni eelmine salvestus käib: `updateSettings`
 * ehitab uue loendi kontekstis olevast väärtusest, ja teine klikk enne esimese
 * vastust kirjutaks esimese muudatuse üle.
 */
import { useCallback, useMemo, useState } from 'react';
import { useUser } from '../contexts/UserContext';
import { favoriteToken, toggleFavorite } from '../components/pickerEntries';

const TUHI: string[] = [];

export function useFavoriteCollections() {
  const { user, userSettings, updateSettings } = useUser();
  const favorites = userSettings?.favorite_collections ?? TUHI;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const isFavorite = useCallback(
    (kind: 'collection' | 'work_set', id: string) => favSet.has(favoriteToken(kind, id)),
    [favSet],
  );

  const toggle = useCallback(async (kind: 'collection' | 'work_set', id: string) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    const ok = await updateSettings({
      favorite_collections: toggleFavorite(favorites, favoriteToken(kind, id)),
    });
    if (!ok) setError(true);
    setBusy(false);
  }, [busy, favorites, updateSettings]);

  return { favorites, isFavorite, toggle, busy, error, enabled: Boolean(user) };
}
