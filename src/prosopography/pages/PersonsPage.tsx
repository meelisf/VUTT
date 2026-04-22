import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { ArrowDownAZ, Search, UserPlus, Users, CheckSquare, Square, GitMerge, X, ChevronLeft, ChevronRight } from 'lucide-react';
import Header from '../../components/Header';
import PersonCard from '../components/PersonCard';
import MergePersonsModal from '../components/MergePersonsModal';
import PersonAdvancedFilters, { type GenderFilter } from '../components/PersonAdvancedFilters';
import { getPersonFacets, listPersons, mergePersons } from '../services/prosopographyService';
import { getVocabularies } from '../../services/collectionService';
import { useUser } from '../../contexts/UserContext';
import type { ProsopoIndexEntry } from '../types';

const LIMIT = 48;

const PersonsPage: React.FC = () => {
  const { t, i18n } = useTranslation(['prosopography', 'common']);
  const { user, authToken } = useUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [persons, setPersons] = useState<ProsopoIndexEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query  = searchParams.get('q') ?? '';
  const originGroup = searchParams.get('origin_group') ?? '';
  const institution = searchParams.get('institution') ?? '';
  const source = searchParams.get('source') ?? '';
  const gender = (searchParams.get('gender') ?? '') as GenderFilter;
  const immYearFrom = searchParams.get('imm_year_from') ?? '';
  const immYearTo = searchParams.get('imm_year_to') ?? '';
  const statusId = searchParams.get('status_id') ?? '';
  const sortBy = searchParams.get('sort_by') ?? 'alpha';
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;
  const [originGroupFacets, setOriginGroupFacets] = useState<{ value: string; label: string; count: number }[]>([]);
  const [institutionFacets, setInstitutionFacets] = useState<{ value: string; count: number }[]>([]);
  const [seisused, setSeisused] = useState<{ id: string; label: { et: string; en: string } }[]>([]);

  // Eraldi state otsingukastile — debounce enne URL uuendamist
  const [inputValue, setInputValue] = useState(query);
  // Sünkroniseeri inputValue kui URL muutub väljastpoolt (nt tagasinupp)
  useEffect(() => { setInputValue(query); }, [query]);
  // Debounce: uuenda URL 300ms pärast viimast klahvivajutust
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputValue !== query) setFilterParam('q', inputValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilterParam = (key: string, value: string) =>
    setSearchParams(p => {
      const n = new URLSearchParams(p);
      value ? n.set(key, value) : n.delete(key);
      n.delete('offset');
      return n;
    }, { replace: true });

  const setQuery  = (v: string)       => setFilterParam('q', v);
  const setOriginGroup = (v: string)  => setFilterParam('origin_group', v);
  const setInstitution = (v: string)  => setFilterParam('institution', v);
  const setSource = (v: string)       => setFilterParam('source', v);
  const setGender = (v: GenderFilter) => setFilterParam('gender', v);
  const setImmYearFrom = (v: string)  => setFilterParam('imm_year_from', v);
  const setImmYearTo = (v: string)    => setFilterParam('imm_year_to', v);
  const setStatusId = (v: string)     => setFilterParam('status_id', v);
  const setSortBy = (v: string)       => setFilterParam('sort_by', v === 'alpha' ? '' : v);

  const setOffset = (v: number) =>
    setSearchParams(p => { const n = new URLSearchParams(p); v > 0 ? n.set('offset', String(v)) : n.delete('offset'); return n; }, { replace: true });

  // Liitmise select-mood (ainult admin)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPersons, setSelectedPersons] = useState<ProsopoIndexEntry[]>([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);


  const isAdmin = user?.role === 'admin';
  const canEdit = user && (user.role === 'editor' || user.role === 'admin');
  const token = authToken ?? '';

  const selectedIds = new Set(selectedPersons.map(p => p.id));

  // Serveripäring — käivitatakse filtri/offset muutusel
  const fetchPersons = useCallback(() => {
    setLoading(true);
    listPersons({
      q: query || undefined,
      origin_group: originGroup || undefined,
      institution: institution || undefined,
      source: source || undefined,
      gender: gender || undefined,
      imm_year_from: immYearFrom ? parseInt(immYearFrom) : undefined,
      imm_year_to: immYearTo ? parseInt(immYearTo) : undefined,
      status_id: statusId || undefined,
      sort_by: sortBy !== 'alpha' ? sortBy : undefined,
      limit: LIMIT,
      offset,
    }, token)
      .then(data => {
        setPersons(data.results);
        setTotal(data.total);
        setError(null);
      })
      .catch(() => setError(t('loadError', 'Isikute laadimine ebaõnnestus.')))
      .finally(() => setLoading(false));
  }, [query, originGroup, institution, source, gender, immYearFrom, immYearTo, statusId, sortBy, offset, token, t]);

  const fetchFacets = useCallback(() => {
    getPersonFacets({
      q: query || undefined,
      gender: gender || undefined,
    }, token)
      .then(data => {
        const lang = i18n.language?.slice(0, 2) ?? 'et';
        setOriginGroupFacets((data.origin_groups || []).map(item => ({
          value: item.value,
          label: item.labels?.[lang] ?? item.labels?.['et'] ?? item.labels?.['en'] ?? item.value,
          count: item.count,
        })));
        setInstitutionFacets(data.institutions || []);
      })
      .catch(() => { setOriginGroupFacets([]); setInstitutionFacets([]); });
  }, [query, gender, token, i18n.language]);

  useEffect(() => {
    fetchPersons();
  }, [fetchPersons]);

  useEffect(() => {
    fetchFacets();
  }, [fetchFacets]);

  useEffect(() => {
    getVocabularies().then(v => { if (v.seisused) setSeisused(v.seisused); }).catch(() => {});
  }, []);

  const hasActiveFilters = !!(originGroup || institution || source || gender || immYearFrom || immYearTo);
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  // Select-mood helpers
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedPersons([]);
    setMergeError(null);
  };

  const toggleSelect = (person: ProsopoIndexEntry) => {
    setSelectedPersons(prev => {
      if (prev.some(p => p.id === person.id)) {
        return prev.filter(p => p.id !== person.id);
      }
      if (prev.length < 2) {
        return [...prev, person];
      }
      return prev;
    });
  };

  const handleMergeConfirm = async (sourceId: string, targetId: string) => {
    setMergeLoading(true);
    setMergeError(null);
    try {
      const result = await mergePersons(sourceId, targetId, token);
      setShowMergeModal(false);
      exitSelectMode();
      fetchPersons();
      navigate(`/persons/${result.id}`);
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : t('loadError'));
    } finally {
      setMergeLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        pageTitle={t('pageTitle', 'Isikud')}
        pageTitleIcon={<Users size={20} className="text-primary-600" />}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* Tööriistariba */}
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex gap-3">
            {/* Otsing */}
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="search"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={t('searchPlaceholder', 'Otsi nime järgi…')}
                className={`w-full pl-9 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 ${inputValue ? 'pr-8' : 'pr-4'}`}
              />
              {inputValue && (
                <button
                  type="button"
                  onClick={() => { setInputValue(''); setQuery(''); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                  aria-label={t('common:form.clearSearch')}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Sortimine */}
            <div className="flex items-center gap-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg px-2 py-1.5 shrink-0">
              <ArrowDownAZ size={15} className="text-gray-400 shrink-0" />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="bg-transparent text-sm text-gray-700 focus:outline-none cursor-pointer"
              >
                <option value="alpha">{t('sortAlpha', 'A–Z')}</option>
                <option value="birth_year">{t('sortBirthYear', 'Sünniaasta')}</option>
                <option value="death_year">{t('sortDeathYear', 'Surmaaasta')}</option>
                <option value="imm_year">{t('sortImmYear', 'Immatrikuleerumine')}</option>
              </select>
            </div>

            {/* Admin: liitmise select-mood */}
            {isAdmin && (
              <button
                onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
                className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                  selectMode
                    ? 'text-white bg-primary-600 hover:bg-primary-700'
                    : 'text-gray-600 bg-white border border-gray-200 hover:bg-gray-50'
                }`}
                title={selectMode ? t('merge.exitSelect', 'Välju valikust') : t('merge.enterSelect', 'Vali liitmiseks')}
              >
                {selectMode ? <CheckSquare size={15} /> : <Square size={15} />}
                {selectMode ? t('merge.exitSelect', 'Tühista') : t('merge.enterSelect', 'Liida')}
              </button>
            )}

            {canEdit && !selectMode && (
              <Link
                to="/persons/new"
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                <UserPlus size={15} />
                {t('addPerson', 'Lisa isik')}
              </Link>
            )}
          </div>

          {/* Täpsemad filtrid */}
          <PersonAdvancedFilters
            originGroup={originGroup}
            institution={institution}
            source={source}
            gender={gender}
            immYearFrom={immYearFrom}
            immYearTo={immYearTo}
            statusId={statusId}
            originGroups={originGroupFacets}
            institutions={institutionFacets}
            seisused={seisused}
            onOriginGroupChange={setOriginGroup}
            onInstitutionChange={setInstitution}
            onSourceChange={setSource}
            onGenderChange={setGender}
            onImmYearFromChange={setImmYearFrom}
            onImmYearToChange={setImmYearTo}
            onStatusIdChange={setStatusId}
            onClearAll={() => setSearchParams(p => {
              const n = new URLSearchParams(p);
              ['origin_group', 'institution', 'source', 'gender', 'imm_year_from', 'imm_year_to', 'status_id', 'offset'].forEach(k => n.delete(k));
              return n;
            }, { replace: true })}
          />
        </div>

        {/* Select-mood toolbar */}
        {selectMode && (
          <div className="mb-4 flex items-center gap-3 bg-primary-50 border border-primary-200 rounded-lg px-4 py-2.5">
            <GitMerge size={16} className="text-primary-600 shrink-0" />
            <p className="text-sm text-primary-800 flex-1">
              {selectedIds.size === 0 && t('merge.hint', 'Vali täpselt 2 isikut liitmiseks.')}
              {selectedIds.size === 1 && t('merge.hintOne', 'Vali veel 1 isik.')}
              {selectedIds.size === 2 && t('merge.hintReady', '2 isikut valitud — saad liita.')}
            </p>
            {selectedIds.size === 2 && (
              <button
                onClick={() => { setMergeError(null); setShowMergeModal(true); }}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                <GitMerge size={14} />
                {t('merge.open', 'Liida…')}
              </button>
            )}
            <button onClick={exitSelectMode} className="text-primary-400 hover:text-primary-600 transition-colors">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Arv */}
        {!(loading || false) && !error && (
          <p className="text-xs text-gray-400 mb-4">
            {offset === 0 && total <= LIMIT
              ? t('totalCount', '{{count}} isikut', { count: total })
              : t('filteredCount', '{{filtered}} / {{total}} isikut', { filtered: Math.min(offset + LIMIT, total), total })}
          </p>
        )}

        {/* Sisu */}
        {(loading || false) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-64 bg-white border border-gray-200 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-16 text-red-600 text-sm">{error}</div>
        )}

        {!(loading || false) && !error && persons.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">
            {query || hasActiveFilters
              ? t('noResults', 'Otsingule vastavaid isikuid ei leitud.')
              : t('empty', 'Prosopograafia andmebaas on tühi.')}
          </div>
        )}

        {!(loading || false) && !error && persons.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {persons.map(person => (
              <PersonCard
                key={person.id}
                person={person}
                selectMode={selectMode}
                selected={selectedIds.has(person.id)}
                onSelect={() => toggleSelect(person)}
              />
            ))}
          </div>
        )}

        {/* Paginatsioon */}
        {!(loading || false) && totalPages > 1 && (
          <div className="flex justify-center items-center gap-3 mt-8 pt-6 border-t border-gray-200">
            <button
              onClick={() => setOffset(offset - LIMIT)}
              disabled={offset === 0}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={16} />
              {t('common:pagination.previous', 'Eelmine')}
            </button>
            <span className="text-sm text-gray-500 font-mono">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= total}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t('common:pagination.next', 'Järgmine')}
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </main>

      {showMergeModal && selectedPersons.length === 2 && (
        <MergePersonsModal
          personA={selectedPersons[0]}
          personB={selectedPersons[1]}
          onConfirm={handleMergeConfirm}
          onClose={() => { setShowMergeModal(false); setMergeError(null); }}
          loading={mergeLoading}
          error={mergeError}
        />
      )}
    </div>
  );
};

export default PersonsPage;
