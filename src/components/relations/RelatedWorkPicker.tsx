import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Work } from '../../types';
import { useMeiliIndex } from '../../contexts/MeilisearchContext';
import { searchWorks } from '../../services/searchService';
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
    searchWorks(index, q, { limit: 10 })
      .then(res => { if (!cancelled) setResults(res.works); })
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
