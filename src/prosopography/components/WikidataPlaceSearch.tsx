import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { searchPlacesWikidata, fetchPlaceWikidata } from '../services/prosopographyService';
import type { PlaceSuggestion, WikidataPlace } from '../services/prosopographyService';
import { ApiError } from '../../services/apiClient';

export default function WikidataPlaceSearch({ initialQuery = '', query: externalQuery, lang, onSelect }: {
  initialQuery?: string;
  query?: string;
  lang: string;
  onSelect: (item: PlaceSuggestion, details: WikidataPlace) => void;
}) {
  const { t } = useTranslation('prosopography');
  const [input, setQuery] = useState(initialQuery);
  const query = externalQuery ?? input;
  const [language, setLanguage] = useState(lang);
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  const errorMessage = (error: unknown) => error instanceof ApiError && error.status === 429
    ? t('place.rateLimit', { seconds: Math.ceil(error.retryAfter || 60) })
    : t('place.searchError');

  useEffect(() => {
    const current = ++generation.current;
    setResults([]);
    setError('');
    setSearched(false);
    setLoading(false);
    if (selected || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      setLoading(true);
      searchPlacesWikidata(query, language).then(items => {
        if (generation.current !== current) return;
        setResults(items);
        setSearched(true);
      }).catch(error => {
        if (generation.current === current) setError(error instanceof ApiError && error.status === 429
          ? t('place.rateLimit', { seconds: Math.ceil(error.retryAfter || 60) }) : t('place.searchError'));
      }).finally(() => {
        if (generation.current === current) setLoading(false);
      });
    }, 500);
    return () => { clearTimeout(timer); generation.current = current + 1; };
  }, [query, language, selected, retry, t]);

  const select = async (item: PlaceSuggestion) => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const details = await fetchPlaceWikidata(item.q);
      if (current !== generation.current) return;
      onSelect(item, details);
      setSelected(true);
      setQuery(item.label);
      setResults([]);
    } catch (error) {
      if (current === generation.current) setError(errorMessage(error));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };

  return <div className="space-y-2">
    <div className="flex gap-2">
      {externalQuery === undefined && <input aria-label={t('place.wikidataSearch')} placeholder={t('place.wikidataPlaceholder')}
        value={query} onChange={e => { ++generation.current; setSelected(false); setQuery(e.target.value); }}
        className="min-w-0 flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded" />}
      <select aria-label={t('place.searchLanguage')} value={language}
        onChange={e => { ++generation.current; setSelected(false); setLanguage(e.target.value); }}
        className="text-sm border border-gray-300 rounded px-1">
        {['et', 'en', 'de', 'la', 'sv', 'da', 'fi', 'lv'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
      </select>
    </div>
    {loading && <p role="status" className="text-xs text-gray-500 flex gap-1 items-center"><Loader2 size={12} className="animate-spin" />{t('placeModal.loadingDetails')}</p>}
    {error && <div role="alert" className="text-xs text-red-600">{error}
      <button type="button" onClick={() => { setSelected(false); setRetry(v => v + 1); }}
        className="ml-2 underline">{t('place.retry')}</button>
    </div>}
    {!loading && !error && searched && !selected && !results.length && <p className="text-xs text-gray-500">{t('place.notFound')}</p>}
    {!!results.length && <div className="border border-gray-200 rounded max-h-56 overflow-y-auto bg-white">
      {results.map(item => <button key={item.q} type="button" disabled={loading}
        onClick={() => select(item)} className="block w-full px-3 py-2 text-left hover:bg-primary-50 border-b last:border-0 disabled:opacity-60">
        <span className="text-sm font-medium">{item.label}</span> <span className="text-xs text-gray-400">{item.q}</span>
        <span className="block text-xs text-gray-600">{item.description}</span>
        {!!item.aliases.length && <span className="block text-xs text-gray-400">{item.aliases.slice(0, 4).join(', ')}</span>}
      </button>)}
    </div>}
  </div>;
}
