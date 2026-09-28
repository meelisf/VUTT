/**
 * Kohtade register (`places.json`) osa vormi kohavalijale: kohalikud soovitused
 * enne Wikidatat. Salvestub registrikirje Q-kood + silt — võrgustik seob osa koha
 * registriga ID kaudu (koordinaadid kaardile), registri võtit osa ei kanna.
 */
import { useEffect, useMemo, useState } from 'react';
import { fetchPlaces } from '../../../prosopography/services/prosopographyService';
import type { PlaceEntry } from '../../../prosopography/types';
import type { SuggestionItem } from '../../../components/EntityPicker';

export function placeSuggestions(places: Record<string, PlaceEntry>, lang: string): SuggestionItem[] {
  const seen = new Set<string>();
  const out: SuggestionItem[] = [];
  for (const e of Object.values(places)) {
    const labels = e.labels ?? {};
    const label = labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0];
    if (!label) continue;
    // Sama Wikidata ID mitme võtme all (nt ajalooline ja tänane nimi) → üks soovitus.
    if (e.id) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
    }
    out.push({ label, id: e.id ?? null, labels, aliases: e.historical_names ?? [] });
  }
  return out;
}

export function usePlaceRegister(lang: string): SuggestionItem[] {
  const [places, setPlaces] = useState<Record<string, PlaceEntry>>({});
  useEffect(() => {
    let cancelled = false;
    // Register on lisainfo: tõrke korral jääb alles Wikidata otsing.
    fetchPlaces().then(p => { if (!cancelled) setPlaces(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return useMemo(() => placeSuggestions(places, lang), [places, lang]);
}
