/**
 * Filtrivihjed avalehe otsingureale (#605, spec 2026-10-15).
 *
 * - Ei tee päringut enne, kui ulatus on valmis (ADR 0042).
 * - Sõnavara = ulatuse fassetikoodid + registri sildid; vahemälu elab hooki
 *   SEES ja selle võti on indeks (vahetub tokeniga) + valiku sisu.
 * - Loendur = SAMA päring, mis vastuvõtu järel jookseb (buildDashboardSearch +
 *   withCandidate), partiidena eeljärjestuses, kuni 3 positiivset.
 * - Iga vihje kannab lähteolekut; vananenud vihjet ei renderdata ega rakendata.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Index } from 'meilisearch';
import { buildDashboardSearch, getScopeFacetCodes, DashboardSearchOptions } from '../searchService';
import { getEntityLabelsCache } from '../entityLabelsService';
import { isAbortError } from '../../utils/isAbortError';
import { isVuttId } from '../../utils/qcodeUtils';
import { normalizeForSearch } from '../../utils/diacritics';
import { detectFilterHints, FilterHintCandidate, VocabEntry } from './detectFilterHints';
import { withCandidate } from './candidateOptions';

export interface FilterHint extends FilterHintCandidate {
  count: number;
  sourceQuery: string;
  stateKey: string;
}

export interface UseFilterHintsArgs {
  index: Index | null;
  query: string;
  searchOptions: DashboardSearchOptions;
  scopeReady: boolean;
  lang: 'et' | 'en';
  debounceMs?: number;
}

const MAX_HINTS = 3;
const BATCH = 3;
const MAX_BATCHES = 4;

// Indeksi identiteet → number (WeakMap ei hoia kasutajaandmeid ega takista GC-d)
const indexIds = new WeakMap<object, number>();
let nextIndexId = 1;
const indexKey = (index: object | null) => {
  if (!index) return 0;
  if (!indexIds.has(index)) indexIds.set(index, nextIndexId++);
  return indexIds.get(index)!;
};

/** Kõik, mis muudab loendureid või rakendamist — v.a päring ise. */
export function hintsStateKey(index: object | null, o: DashboardSearchOptions): string {
  const { signal: _s, offset: _o, limit: _l, ...rest } = o;
  return `${indexKey(index)}|${JSON.stringify(rest)}`;
}

const scopeKey = (o: DashboardSearchOptions) => JSON.stringify(o.collection ?? null);

/** Kas kandidaat on juba rakendatud? Võrdleb Q-koodi JA sildiga (URL võib kanda silti). */
function isApplied(c: FilterHintCandidate, o: DashboardSearchOptions, vocab: VocabEntry[]): boolean {
  if (c.kind === 'year') return String(o.yearStart ?? '') === c.value && String(o.yearEnd ?? '') === c.value;
  const current = c.kind === 'genre' ? o.genre : c.kind === 'type' ? o.type : o.teoseTags;
  if (!current?.length) return false;
  const entry = vocab.find(v => v.kind === c.kind && v.id === c.value);
  const names = new Set([c.value, ...Object.values(entry?.labels || {})].filter(Boolean).map(s => normalizeForSearch(s!)));
  return current.some(v => names.has(normalizeForSearch(v)));
}

export function useFilterHints({ index, query, searchOptions, scopeReady, lang, debounceMs = 400 }: UseFilterHintsArgs) {
  const [hints, setHints] = useState<FilterHint[]>([]);
  const vocabCache = useRef<{ key: string; vocab: VocabEntry[] } | null>(null);
  const stateKey = hintsStateKey(index, searchOptions);
  const sKey = `${indexKey(index)}|${scopeKey(searchOptions)}`;

  useEffect(() => {
    // Tühja päringu korral pole midagi arvutada; vanad vihjed peidab isCurrent-filter
    if (!index || !scopeReady || !query.trim()) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(async () => {
      try {
        // 1. Sõnavara (vahemälust, kui ulatus + indeks samad)
        let vocab = vocabCache.current?.key === sKey ? vocabCache.current.vocab : null;
        if (!vocab) {
          const [codes, registry] = await Promise.all([
            getScopeFacetCodes(index, searchOptions.collection, signal),
            getEntityLabelsCache(),
          ]);
          const built: VocabEntry[] = [];
          const add = (kind: VocabEntry['kind'], map: Record<string, number>) => {
            for (const [id, count] of Object.entries(map)) {
              if (isVuttId(id)) continue;
              const l = registry[id];
              if (!l?.et && !l?.en) continue; // ilma registrisildita koodi ei pakuta
              built.push({ kind, id, labels: { et: l.et, en: l.en }, facetCount: count });
            }
          };
          add('genre', codes.genre_ids); add('tag', codes.tags_ids); add('type', codes.type_ids);
          vocabCache.current = { key: sKey, vocab: built };
          vocab = built;
        }
        const vocabNow = vocab;

        // 2. Kandidaadid eeljärjestuses, juba rakendatud välja
        const ranked = detectFilterHints(query, vocabNow, lang).filter(c => !isApplied(c, searchOptions, vocabNow));

        // 3. Loendurid partiidena, kuni MAX_HINTS positiivset
        const found: FilterHint[] = [];
        for (let b = 0; b < MAX_BATCHES && found.length < MAX_HINTS; b++) {
          const batch = ranked.slice(b * BATCH, (b + 1) * BATCH);
          if (batch.length === 0) break;
          const counts = await Promise.all(batch.map(async c => {
            const core = buildDashboardSearch(c.remainingQuery, withCandidate(searchOptions, c));
            const r = await index.search(core.q, {
              filter: core.filter, attributesToSearchOn: core.attributesToSearchOn,
              matchingStrategy: core.matchingStrategy, limit: 0,
            }, { signal });
            return (r as { totalHits?: number }).totalHits ?? r.estimatedTotalHits ?? 0;
          }));
          batch.forEach((c, i) => {
            if (counts[i] > 0 && found.length < MAX_HINTS) found.push({ ...c, count: counts[i], sourceQuery: query, stateKey });
          });
        }
        if (!signal.aborted) setHints(found);
      } catch (e) {
        // Vihje on parim-pingutus: viga ei sega otsingut ega lähe vearingi
        if (!signal.aborted && !isAbortError(e)) setHints([]);
      }
    }, debounceMs);
    return () => { clearTimeout(timer); controller.abort(); };
    // searchOptions on stateKey-s; objekti identiteet ei tohi effecti käivitada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, scopeReady, query, stateKey, sKey, lang, debounceMs]);

  const isCurrent = useCallback(
    (h: FilterHint) => h.sourceQuery === query && h.stateKey === stateKey,
    [query, stateKey],
  );

  // Vananenud vihjed peidetakse KOHE, mitte alles uue arvutuse lõpus
  return { hints: hints.filter(isCurrent), isCurrent };
}
