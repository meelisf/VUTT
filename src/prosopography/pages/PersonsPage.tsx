import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { Search, UserPlus, Users, CheckSquare, Square, GitMerge, X } from 'lucide-react';
import Header from '../../components/Header';
import PersonCard from '../components/PersonCard';
import MergePersonsModal from '../components/MergePersonsModal';
import PersonAdvancedFilters, { type GenderFilter, type SourceFilter, type LevelFilter } from '../components/PersonAdvancedFilters';
import { listPersons, mergePersons } from '../services/prosopographyService';
import { useUser } from '../../contexts/UserContext';
import type { ProsopoIndexEntry } from '../types';

const PersonsPage: React.FC = () => {
  const { t } = useTranslation(['common']);
  const { user, authToken } = useUser();
  const navigate = useNavigate();

  const [allPersons, setAllPersons] = useState<ProsopoIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [gender, setGender] = useState<GenderFilter>('');
  const [source, setSource] = useState<SourceFilter>('');
  const [level, setLevel] = useState<LevelFilter>('');

  // Liitmise select-mood (ainult admin)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);

  const isAdmin = user?.role === 'admin';
  const canEdit = user && (user.role === 'editor' || user.role === 'admin');
  const token = authToken ?? '';

  useEffect(() => {
    setLoading(true);
    listPersons(undefined, token)
      .then(data => {
        setAllPersons(data.results);
        setError(null);
      })
      .catch(() => setError(t('prosopography.loadError', 'Isikute laadimine ebaõnnestus.')))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allPersons.filter(p => {
      if (q && !(p.label.toLowerCase().includes(q) || p.sort_name.toLowerCase().includes(q))) return false;
      if (gender === 'M' && p.gender !== 'M') return false;
      if (gender === 'F' && p.gender !== 'F') return false;
      if (source === 'wikidata' && !p.has_wikidata) return false;
      if (source === 'gnd'      && !p.has_gnd)      return false;
      if (source === 'aa'       && !p.has_aa)        return false;
      if (level && p.verification_level !== level) return false;
      return true;
    });
  }, [allPersons, query, gender, source, level]);

  const hasActiveFilters = !!(gender || source || level);

  // Select-mood helpers
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setMergeError(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      }
      return next;
    });
  };

  const selectedPersons = useMemo(
    () => allPersons.filter(p => selectedIds.has(p.id)),
    [allPersons, selectedIds],
  );

  const handleMergeConfirm = async (sourceId: string, targetId: string) => {
    setMergeLoading(true);
    setMergeError(null);
    try {
      const result = await mergePersons(sourceId, targetId, token);
      setShowMergeModal(false);
      exitSelectMode();
      // Uuenda lokaalne nimekiri: eemalda source
      setAllPersons(prev => prev.filter(p => p.id !== sourceId));
      navigate(`/persons/${result.id}`);
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'Liitmine ebaõnnestus.');
    } finally {
      setMergeLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        pageTitle={t('prosopography.pageTitle', 'Isikud')}
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
                placeholder={t('prosopography.searchPlaceholder', 'Otsi nime järgi…')}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
              />
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
                title={selectMode ? t('prosopography.merge.exitSelect', 'Välju valikust') : t('prosopography.merge.enterSelect', 'Vali liitmiseks')}
              >
                {selectMode ? <CheckSquare size={15} /> : <Square size={15} />}
                {selectMode ? t('prosopography.merge.exitSelect', 'Tühista') : t('prosopography.merge.enterSelect', 'Liida')}
              </button>
            )}

            {canEdit && !selectMode && (
              <Link
                to="/persons/new"
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                <UserPlus size={15} />
                {t('prosopography.addPerson', 'Lisa isik')}
              </Link>
            )}
          </div>

          {/* Täpsemad filtrid */}
          <PersonAdvancedFilters
            gender={gender}
            source={source}
            level={level}
            onGenderChange={setGender}
            onSourceChange={setSource}
            onLevelChange={setLevel}
          />
        </div>

        {/* Select-mood toolbar */}
        {selectMode && (
          <div className="mb-4 flex items-center gap-3 bg-primary-50 border border-primary-200 rounded-lg px-4 py-2.5">
            <GitMerge size={16} className="text-primary-600 shrink-0" />
            <p className="text-sm text-primary-800 flex-1">
              {selectedIds.size === 0 && t('prosopography.merge.hint', 'Vali täpselt 2 isikut liitmiseks.')}
              {selectedIds.size === 1 && t('prosopography.merge.hintOne', 'Vali veel 1 isik.')}
              {selectedIds.size === 2 && t('prosopography.merge.hintReady', '2 isikut valitud — saad liita.')}
            </p>
            {selectedIds.size === 2 && (
              <button
                onClick={() => { setMergeError(null); setShowMergeModal(true); }}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                <GitMerge size={14} />
                {t('prosopography.merge.open', 'Liida…')}
              </button>
            )}
            <button onClick={exitSelectMode} className="text-primary-400 hover:text-primary-600 transition-colors">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Arv */}
        {!loading && !error && (
          <p className="text-xs text-gray-400 mb-4">
            {filtered.length === allPersons.length
              ? t('prosopography.totalCount', '{{count}} isikut', { count: allPersons.length })
              : t('prosopography.filteredCount', '{{filtered}} / {{total}} isikut', { filtered: filtered.length, total: allPersons.length })}
          </p>
        )}

        {/* Sisu */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-64 bg-white border border-gray-200 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-16 text-red-600 text-sm">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm">
            {query || hasActiveFilters
              ? t('prosopography.noResults', 'Otsingule vastavaid isikuid ei leitud.')
              : t('prosopography.empty', 'Prosopograafia andmebaas on tühi.')}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(person => (
              <PersonCard
                key={person.id}
                person={person}
                selectMode={selectMode}
                selected={selectedIds.has(person.id)}
                onSelect={toggleSelect}
              />
            ))}
          </div>
        )}
      </main>

      {/* Merge modal */}
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
