import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Search, UserPlus, Users, ChevronDown, X } from 'lucide-react';
import Header from '../../components/Header';
import PersonCard from '../components/PersonCard';
import { listPersons } from '../services/prosopographyService';
import { useUser } from '../../contexts/UserContext';
import type { ProsopoIndexEntry } from '../types';

type GenderFilter = '' | 'M' | 'F';
type SourceFilter = '' | 'wikidata' | 'gnd' | 'aa';
type LevelFilter = '' | 'draft' | 'reviewed' | 'verified';

const PersonsPage: React.FC = () => {
  const { t } = useTranslation(['common']);
  const { user } = useUser();

  const [allPersons, setAllPersons] = useState<ProsopoIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtrid (kliendipoolsed)
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState<GenderFilter>('');
  const [source, setSource] = useState<SourceFilter>('');
  const [level, setLevel] = useState<LevelFilter>('');

  const canEdit = user && (user.role === 'editor' || user.role === 'admin');
  const token = user?.token ?? '';

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

  const hasActiveFilters = gender || source || level;

  const clearFilters = () => { setGender(''); setSource(''); setLevel(''); };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        pageTitle={t('prosopography.pageTitle', 'Isikud')}
        pageTitleIcon={<Users size={20} className="text-primary-600" />}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* Tööriistariba */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
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

          {/* Filtrid */}
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect
              value={gender}
              onChange={v => setGender(v as GenderFilter)}
              options={[
                { value: '', label: t('prosopography.filterGenderAll', 'Sugu') },
                { value: 'M', label: t('prosopography.filterMale', 'Meessoost') },
                { value: 'F', label: t('prosopography.filterFemale', 'Naissoost') },
              ]}
              active={!!gender}
            />
            <FilterSelect
              value={source}
              onChange={v => setSource(v as SourceFilter)}
              options={[
                { value: '',         label: t('prosopography.filterSourceAll', 'Allikas') },
                { value: 'wikidata', label: 'Wikidata' },
                { value: 'gnd',      label: 'GND' },
                { value: 'aa',       label: 'Album Acad.' },
              ]}
              active={!!source}
            />
            <FilterSelect
              value={level}
              onChange={v => setLevel(v as LevelFilter)}
              options={[
                { value: '',         label: t('prosopography.filterLevelAll', 'Olek') },
                { value: 'draft',    label: t('prosopography.levelDraft',    'Mustand') },
                { value: 'reviewed', label: t('prosopography.levelReviewed', 'Üle vaadatud') },
                { value: 'verified', label: t('prosopography.levelVerified', 'Kontrollitud') },
              ]}
              active={!!level}
            />
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              >
                <X size={12} />
                {t('prosopography.clearFilters', 'Tühista')}
              </button>
            )}

            {canEdit && (
              <Link
                to="/persons/new"
                className="ml-auto sm:ml-2 flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
              >
                <UserPlus size={15} />
                {t('prosopography.addPerson', 'Lisa isik')}
              </Link>
            )}
          </div>
        </div>

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
              <div key={i} className="h-44 bg-white border border-stone-200 rounded-lg animate-pulse" />
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
              <PersonCard key={person.id} person={person} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

// =========================================================
// Abikomponen: filter-dropdown
// =========================================================
interface FilterOption { value: string; label: string; }
interface FilterSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  active?: boolean;
}

const FilterSelect: React.FC<FilterSelectProps> = ({ value, onChange, options, active }) => (
  <div className="relative">
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`appearance-none text-sm pl-3 pr-7 py-2 rounded-lg border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-300 ${
        active
          ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
      }`}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
  </div>
);

export default PersonsPage;
