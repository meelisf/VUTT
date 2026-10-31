import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Work } from '../../types';
import { useMeiliIndex } from '../../contexts/MeilisearchContext';
import { searchWorks } from '../../services/searchService';
import { getWorkMetadata } from '../../services/workService';
import { workDisplayTitle } from '../../utils/workTitle';

interface RelatedWorkPickerProps {
  /** Praegune teos ja juba seotud teosed — neid ei pakuta. */
  excludeIds: string[];
  lang: string;
  onPick: (workId: string) => void;
}

/**
 * Teoseotsing seose jaoks. Ligipääs tuleb Meili tenant-tokenist; aktiivse kogu
 * filtrit (scopeClauses) EI rakendata — variant võib asuda teises kogus (ADR 0075).
 */
const RelatedWorkPicker: React.FC<RelatedWorkPickerProps> = ({ excludeIds, lang, onPick }) => {
  const { t } = useTranslation(['common']);
  const index = useMeiliIndex();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Work[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!index || q.length < 1) { setResults([]); return; }
    let cancelled = false;
    // Aastaarv → aastafilter; work_id-laadne sõne → otsene leid + tekstiotsing.
    // Avalehe otsinguväljad ei sisalda aastat ega work_id-d, aga samanimeliste
    // variantide eristamiseks on just need vajalikud.
    const isYear = /^\d{4}$/.test(q);
    const looksLikeId = /^[A-Za-z0-9_-]{6,12}$/.test(q) && !isYear;
    const textSearch = isYear
      ? searchWorks(index, '', { limit: 10, yearStart: q, yearEnd: q })
      : searchWorks(index, q, { limit: 10 });
    const byId = looksLikeId
      ? Promise.resolve().then(() => getWorkMetadata(index, q)).catch(() => undefined)
      : Promise.resolve(undefined);
    Promise.all([textSearch, byId])
      .then(([res, exact]) => {
        if (cancelled) return;
        const works = res.works.filter(w => w.work_id !== (exact as Work | undefined)?.work_id);
        setResults(exact ? [exact as Work, ...works] : works);
      })
      .catch(() => { if (!cancelled) setResults([]); });
    return () => { cancelled = true; };
  }, [index, query]);

  const shown = results.filter(w => !excludeIds.includes(w.work_id));
  return (
    <div className="mt-2">
      <input
        type="text"
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('common:workRelations.searchPlaceholder', 'Pealkiri, aasta või work_id')}
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
      />
      {shown.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
          {shown.map(w => (
            <li key={w.work_id}>
              <button type="button" onClick={() => onPick(w.work_id)}
                      className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-50">
                <span className="text-gray-800">{workDisplayTitle(w, lang).main}</span>
                <span className="ml-1 text-xs text-gray-400">{w.year_display || w.year} · {w.work_id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RelatedWorkPicker;
