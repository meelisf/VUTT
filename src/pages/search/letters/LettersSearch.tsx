import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, X, Filter } from 'lucide-react';
import Header from '../../../components/Header';
import Pagination from '../../../components/Pagination';
import { useCollectionUrlSync } from '../../../hooks/useCollectionUrlSync';
import { useSelectionScope } from '../../../hooks/useSelectionScope';
import type { LetterFilters as Filters } from '../../../services/letterSearch';
import SearchUnitToggle from '../SearchUnitToggle';
import CollectionBar from '../../../components/CollectionBar';
import { readLetterFilters, writeLetterFilters } from '../searchUnit';
import LetterFilters from './LetterFilters';
import LetterResults from './LetterResults';
import { useLetterSearch } from './useLetterSearch';

const RETURN_URL_KEY = 'vutt_return_url';

/** Kirjaotsing (#526, ADR 0065): `/search?unit=letters`. Tulemuse ühik on kiri. */
const LettersSearch: React.FC = () => {
  const { t } = useTranslation(['search', 'common']);
  const [searchParams, setSearchParams] = useSearchParams();
  // Üks URL-sünkroniseerija lehe kohta (ADR 0038) — täisteksti režiim ei ole samal ajal monteeritud.
  useCollectionUrlSync();
  const { scope, ready: scopeReady, error: scopeError } = useSelectionScope();

  const query = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('p') || '1', 10) || 1);
  const filters = useMemo(() => readLetterFilters(searchParams), [searchParams]);
  const [input, setInput] = useState(query);
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);
  useEffect(() => { setInput(query); }, [query]);

  // Tagasi-link teoselt viib samasse otsingusse (sama võti mis täisteksti režiimis).
  useEffect(() => {
    sessionStorage.setItem(RETURN_URL_KEY, '/search?' + searchParams.toString());
  }, [searchParams]);

  const { result, loading, error } = useLetterSearch(query, filters, page, scope, scopeReady);

  const update = (mutate: (p: URLSearchParams) => void, resetPage = true) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      mutate(next);
      if (resetPage) next.delete('p');
      return next;
    });
  };

  const onFiltersChange = (next: Filters) => update(p => writeLetterFilters(p, next));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    update(p => { if (input.trim()) p.set('q', input.trim()); else p.delete('q'); });
  };

  const message = error || scopeError?.message || null;

  return (
    <div className="h-full bg-gray-50 font-sans flex flex-col">
      <Header>
        {/* Kogu-riba nagu Dashboardil ja isikute lehel (#587) */}
        <CollectionBar />
        <div className="bg-white border-b border-gray-200 py-4">
          {/* Raam = päis ja CollectionBar (max-w-7xl + px-4 sm:px-8), et otsingukast joonduks logo ja keelevalijaga */}
          <div className="max-w-7xl mx-auto px-4 sm:px-8">
            <SearchUnitToggle unit="letters" />
            <form onSubmit={submit} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={t('letters.placeholder')}
                  className={`w-full pl-12 py-3 rounded-lg border border-gray-300 shadow-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-500 outline-none text-lg ${input ? 'pr-10' : 'pr-4'}`}
                  autoFocus
                />
                {input && (
                  <button type="button" onClick={() => setInput('')} tabIndex={-1}
                    aria-label={t('common:form.clearSearch')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X size={18} />
                  </button>
                )}
              </div>
              <button type="submit" className="bg-primary-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-primary-700 transition-colors shadow-sm">
                {t('form.search')}
              </button>
              <button type="button" onClick={() => setShowFiltersMobile(v => !v)}
                className="md:hidden p-3 bg-white border border-gray-300 rounded-lg text-gray-600" aria-label={t('filters.title')}>
                <Filter size={20} />
              </button>
            </form>
          </div>
        </div>
      </Header>

      <div className="flex-1 overflow-hidden flex max-w-7xl mx-auto w-full md:px-8">
        {/* Laius ja täidis = täisteksti külgriba (SearchFilters), muidu hüppab lüliti režiimivahetusel */}
        <aside className={`${showFiltersMobile ? 'block' : 'hidden'} md:block w-full md:w-64 p-6 shrink-0 overflow-y-auto border-r md:border-l border-gray-200 bg-white`}>
          <LetterFilters filters={filters} facets={result?.facetDistribution ?? {}} hasQuery={!!query} onChange={onFiltersChange} />
        </aside>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {message ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</div>
          ) : !result && loading ? (
            <div className="text-sm text-gray-500">{t('letters.loading')}</div>
          ) : result && result.hits.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">{t('letters.noResults')}</div>
          ) : result ? (
            <>
              <div className={`mb-3 text-sm text-gray-600 ${loading ? 'opacity-60' : ''}`}>
                {t('letters.count', { count: result.totalHits })}
              </div>
              <div className={loading ? 'opacity-60' : ''}>
                <LetterResults hits={result.hits} />
              </div>
              <Pagination
                currentPage={page}
                totalPages={result.totalPages}
                onPageChange={n => update(p => p.set('p', String(n)), false)}
                className="mt-6"
              />
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export default LettersSearch;
