import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Search, UserPlus, Users, CheckSquare, Square, GitMerge, X, ChevronLeft, ChevronRight, Briefcase } from 'lucide-react';
import Header from '../../components/Header';
import PersonCard from '../components/PersonCard';
import MergePersonsModal from '../components/MergePersonsModal';
import BulkOccupationModal from '../components/BulkOccupationModal';
import PersonAdvancedFilters, { type GenderFilter } from '../components/PersonAdvancedFilters';
import { getPersonFacets, listPersons, mergePersons, bulkUpdateOccupation } from '../services/prosopographyService';
import type { LinkedEntity } from '../../types/LinkedEntity';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { index } from '../../services/meiliService';
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
  const occupation = searchParams.get('occupation') ?? '';
  const gender = (searchParams.get('gender') ?? '') as GenderFilter;
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;
  const [occupationFacets, setOccupationFacets] = useState<{ value: string; label: string; count: number }[]>([]);

  const setFilterParam = (key: string, value: string) =>
    setSearchParams(p => {
      const n = new URLSearchParams(p);
      value ? n.set(key, value) : n.delete(key);
      n.delete('offset');
      return n;
    }, { replace: true });

  const setQuery  = (v: string)       => setFilterParam('q', v);
  const setOccupation = (v: string)   => setFilterParam('occupation', v);
  const setGender = (v: GenderFilter) => setFilterParam('gender', v);

  const resetOffset = () =>
    setSearchParams(p => { const n = new URLSearchParams(p); n.delete('offset'); return n; }, { replace: true });

  const setOffset = (v: number) =>
    setSearchParams(p => { const n = new URLSearchParams(p); v > 0 ? n.set('offset', String(v)) : n.delete('offset'); return n; }, { replace: true });

  // Kollektsiooni filter — headerist
  const { selectedCollection } = useCollection();
  const [collectionPersonIds, setCollectionPersonIds] = useState<Set<string> | null>(null);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const prevSelectedCollectionRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const prev = prevSelectedCollectionRef.current;
    if (prev !== undefined && prev !== selectedCollection) {
      resetOffset();
    }
    prevSelectedCollectionRef.current = selectedCollection;
  }, [selectedCollection]);

  useEffect(() => {
    if (!selectedCollection) { setCollectionPersonIds(null); return; }
    setCollectionLoading(true);
    index.search('', {
      filter: [`collections_hierarchy = "${selectedCollection}"`, 'lehekylje_number = 1'],
      attributesToRetrieve: ['creators', 'tags_object', 'tags', 'publisher_object'],
      limit: 5000,
    }).then(res => {
      const ids = new Set<string>();
      for (const hit of res.hits) {
        for (const c of (hit.creators ?? [])) {
          if (typeof c.id === 'string' && c.id.startsWith('vutt:P')) ids.add(c.id);
        }
        for (const tag of ((hit as any).tags_object ?? hit.tags ?? [])) {
          if (typeof tag.id === 'string' && tag.id.startsWith('vutt:P')) ids.add(tag.id);
        }
        const pub = (hit as any).publisher_object;
        if (pub && typeof pub.id === 'string' && pub.id.startsWith('vutt:P')) ids.add(pub.id);
      }
      setCollectionPersonIds(ids);
    }).finally(() => setCollectionLoading(false));
  }, [selectedCollection]);

  // Liitmise select-mood (ainult admin)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPersons, setSelectedPersons] = useState<ProsopoIndexEntry[]>([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);

  const [showBulkOccupation, setShowBulkOccupation] = useState(false);
  const [bulkOccupationLoading, setBulkOccupationLoading] = useState(false);

  const isAdmin = user?.role === 'admin';
  const canEdit = user && (user.role === 'editor' || user.role === 'admin');
  const token = authToken ?? '';

  const selectedIds = new Set(selectedPersons.map(p => p.id));

  // Serveripäring — käivitatakse filtri/offset muutusel
  const fetchPersons = useCallback(() => {
    if (collectionLoading) return;
    setLoading(true);
    const idsParam = collectionPersonIds ? Array.from(collectionPersonIds) : undefined;
    listPersons({
      q: query || undefined,
      occupation: occupation || undefined,
      gender: gender || undefined,
      ids: idsParam,
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
  }, [query, occupation, gender, offset, token, collectionPersonIds, collectionLoading, t]);

  const fetchFacets = useCallback(() => {
    if (collectionLoading) return;
    const idsParam = collectionPersonIds ? Array.from(collectionPersonIds) : undefined;
    getPersonFacets({
      q: query || undefined,
      gender: gender || undefined,
      ids: idsParam,
    }, token)
      .then(data => {
        setOccupationFacets((data.occupations || []).map(item => ({
          value: item.id || item.label,
          label: item.labels?.[i18n.language] || item.labels?.et || item.labels?.en || item.label || item.id || '',
          count: item.count,
        })));
      })
      .catch(() => setOccupationFacets([]));
  }, [query, gender, token, collectionPersonIds, collectionLoading, i18n.language]);

  useEffect(() => {
    fetchPersons();
  }, [fetchPersons]);

  useEffect(() => {
    fetchFacets();
  }, [fetchFacets]);

  const hasActiveFilters = !!(occupation || gender);
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

  const handleBulkOccupation = async (occ: LinkedEntity, mode: 'add' | 'replace') => {
    setBulkOccupationLoading(true);
    // Laadi kõik filtreeritud isikud (mitte ainult lehekülje)
    const idsParam = collectionPersonIds ? Array.from(collectionPersonIds) : undefined;
    const all = await listPersons({
      q: query || undefined,
      occupation: occupation || undefined,
      gender: gender || undefined,
      ids: idsParam,
      limit: 5000,
      offset: 0,
    }, token);
    const ids = all.results.map(p => p.id);
    await bulkUpdateOccupation(occ, mode, ids, token);
    setBulkOccupationLoading(false);
    setShowBulkOccupation(false);
    fetchPersons();
    fetchFacets();
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
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder', 'Otsi nime järgi…')}
                className={`w-full pl-9 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 ${query ? 'pr-8' : 'pr-4'}`}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                  aria-label="Tühjenda otsing"
                >
                  <X size={14} />
                </button>
              )}
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

            {canEdit && !selectMode && total > 0 && (
              <button
                onClick={() => setShowBulkOccupation(true)}
                disabled={bulkOccupationLoading}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                title={t('bulkOccupation.title', 'Määra amet')}
              >
                <Briefcase size={15} />
                {t('bulkOccupation.title', 'Määra amet')}
                {total > 0 && <span className="text-xs text-gray-400">({total})</span>}
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
            occupation={occupation}
            gender={gender}
            occupations={occupationFacets}
            onOccupationChange={setOccupation}
            onGenderChange={setGender}
            onClearAll={() => setSearchParams(p => {
              const n = new URLSearchParams(p);
              n.delete('occupation');
              n.delete('gender');
              n.delete('offset');
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
        {!(loading || collectionLoading) && !error && (
          <p className="text-xs text-gray-400 mb-4">
            {offset === 0 && total <= LIMIT
              ? t('totalCount', '{{count}} isikut', { count: total })
              : t('filteredCount', '{{filtered}} / {{total}} isikut', { filtered: Math.min(offset + LIMIT, total), total })}
          </p>
        )}

        {/* Sisu */}
        {(loading || collectionLoading) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-64 bg-white border border-gray-200 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-16 text-red-600 text-sm">{error}</div>
        )}

        {!(loading || collectionLoading) && !error && persons.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">
            {query || hasActiveFilters
              ? t('noResults', 'Otsingule vastavaid isikuid ei leitud.')
              : t('empty', 'Prosopograafia andmebaas on tühi.')}
          </div>
        )}

        {!(loading || collectionLoading) && !error && persons.length > 0 && (
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
        {!(loading || collectionLoading) && totalPages > 1 && (
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

      {/* Merge modal */}
      {showBulkOccupation && (
        <BulkOccupationModal
          personCount={total}
          onClose={() => setShowBulkOccupation(false)}
          onApply={handleBulkOccupation}
        />
      )}

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
