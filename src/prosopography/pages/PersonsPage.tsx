import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { isAtLeast } from '../../utils/roleUtils';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { ArrowDownAZ, Search, UserPlus, CheckSquare, Square, GitMerge, X, Map as MapIcon, List, LayoutGrid, Waypoints } from 'lucide-react';
import Header from '../../components/Header';
import CollectionBar from '../../components/CollectionBar';
import Pagination from '../../components/Pagination';
import PersonCard from '../components/PersonCard';
import MergePersonsModal from '../components/MergePersonsModal';
import PersonListRow from '../components/PersonListRow';
import PersonFilterSections, { type GenderFilter } from '../components/PersonFilterSections';
import FilterSidebar, { MobileFiltersButton } from '../../components/filters/FilterSidebar';
import { FilterChip } from '../../components/workFilters/WorkFilterChips';
import ResultsViewToggle from '../../components/ResultsViewToggle';
import { useFilterSidebarOpen, useResultsView } from '../../hooks/useResultsView';
import { getPersonFacets, listPersons, mergePersons } from '../services/prosopographyService';
import { getVocabularies } from '../../services/collectionService';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { useLatestQuery } from '../../hooks/useLatestQuery';
import type { ProsopoIndexEntry, ProsopoMapResponse } from '../types';
import { relatedMapScope, RELATED_SCOPE_PARAM, RELATED_SCOPE_COLLECTION } from '../utils/relatedMapScope';

const LIMIT = 48;
// Unit Separator — märksõna ise võib sisaldada tühikuid ja komasid
// ("kreeka keele professor"), seega tavaline eraldaja ei sobi.
const TAG_SEP = '\u001F';
const PersonsMap = React.lazy(() => import('../components/PersonsMap'));

const PersonsPage: React.FC = () => {
  const { t, i18n } = useTranslation(['prosopography', 'common']);
  const { user, authToken } = useUser();
  const { selection, selectedCollection, collections, workSets, getCollectionName } = useCollection();
  // Töökollektsioon: ID-loendi koostab ja ligipääsu kontrollib SERVER
  // (`work_set` parameeter), mitte klient — isikute filter käib teose-isiku
  // seoste kaudu, mida kliendil ei ole (#354).
  const workSetParam = selection.kind === 'work_set' ? selection.id : undefined;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const query  = searchParams.get('q') ?? '';
  const originGroup = searchParams.get('origin_group') ?? '';
  const originPlace = searchParams.get('origin_place') ?? '';
  const institution = searchParams.get('institution') ?? '';
  const source = searchParams.get('source') ?? '';
  const gender = (searchParams.get('gender') ?? '') as GenderFilter;
  const explicitYearFrom = searchParams.get('year_from');
  const explicitYearTo = searchParams.get('year_to');
  const legacyImmYearFrom = searchParams.get('imm_year_from');
  const legacyImmYearTo = searchParams.get('imm_year_to');
  const yearFrom = explicitYearFrom ?? legacyImmYearFrom ?? '';
  const yearTo = explicitYearTo ?? legacyImmYearTo ?? '';
  const hasExplicitYearRange = explicitYearFrom !== null || explicitYearTo !== null;
  const statusId = searchParams.get('status_id') ?? '';
  // Märksõnad — URL toetab kordust (?tag=A&tag=B), UI valib praegu ühe.
  // Stabiilne string on vajalik, sest getAll() annab igal renderdusel uue massiivi
  // ja see destabiliseeriks useCallback deps-listi (lõputu päringutsükkel).
  const tagsKey = searchParams.getAll('tag').join(TAG_SEP);
  const tags = useMemo(() => (tagsKey ? tagsKey.split(TAG_SEP) : []), [tagsKey]);
  const sortBy = searchParams.get('sort_by') ?? 'alpha';
  const view = searchParams.get('view') === 'map' ? 'map' : 'list';
  const focusPlace = searchParams.get('focus_place') ?? '';
  const relatedTo = searchParams.get('related_to') ?? '';
  const relatedScope = searchParams.get(RELATED_SCOPE_PARAM);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;
  // Ruudustik ↔ loend on eelistus (meelde lehe kaupa, #587); geograafiline
  // kaart ei ole eelistus, vaid URL-i olek (`view=map`, jagatav link).
  const [resultsView, changeResultsView] = useResultsView('persons');
  const [sidebarOpen, setSidebarOpen] = useFilterSidebarOpen('persons');
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [seisused, setSeisused] = useState<{ id: string; label: { et: string; en: string } }[]>([]);

  // Eraldi state otsingukastile — debounce enne URL uuendamist
  const [inputValue, setInputValue] = useState(query);
  // Sünkroniseeri inputValue kui URL muutub väljastpoolt (nt tagasinupp)
  useEffect(() => { setInputValue(query); }, [query]);
  useEffect(() => {
    setSearchParams(p => { const n = new URLSearchParams(p); n.delete('offset'); return n; }, { replace: true });
  }, [selectedCollection, workSetParam]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const setOriginPlace = (v: string)  => setFilterParam('origin_place', v);
  const setInstitution = (v: string)  => setFilterParam('institution', v);
  const setSource = (v: string)       => setFilterParam('source', v);
  const setGender = (v: GenderFilter) => setFilterParam('gender', v);
  const setYearParam = (key: 'year_from' | 'year_to', legacyKey: 'imm_year_from' | 'imm_year_to', value: string) =>
    setSearchParams(p => {
      const n = new URLSearchParams(p);
      value ? n.set(key, value) : n.delete(key);
      n.delete(legacyKey);
      n.delete('offset');
      return n;
    }, { replace: true });
  const setYearFrom = (v: string)     => setYearParam('year_from', 'imm_year_from', v);
  const setYearTo = (v: string)       => setYearParam('year_to', 'imm_year_to', v);
  const setStatusId = (v: string)     => setFilterParam('status_id', v);
  // Uus valik asendab kõik senised märksõnad (UI on üksikvalik).
  const setTag = (v: string) =>
    setSearchParams(p => {
      const n = new URLSearchParams(p);
      n.delete('tag');
      if (v) n.append('tag', v);
      n.delete('offset');
      return n;
    }, { replace: true });
  const setSortBy = (v: string)       => setFilterParam('sort_by', v === 'alpha' ? '' : v);
  const setView = (v: 'list' | 'map') =>
    setSearchParams(p => {
      const n = new URLSearchParams(p);
      v === 'map' ? n.set('view', 'map') : n.delete('view');
      if (v === 'list') {
        n.delete('focus_place');
        n.delete('related_to');
        n.delete(RELATED_SCOPE_PARAM);
      }
      n.delete('offset');
      return n;
    }, { replace: true });

  const viewValue: 'cards' | 'list' | 'map' = view === 'map' ? 'map' : resultsView;
  const handleViewChange = (v: 'cards' | 'list' | 'map') => {
    if (v === 'map') { setView('map'); return; }
    changeResultsView(v);
    if (view === 'map') setView('list');
  };

  // Seoste-filtri (related_to) fookus-isik: nime teab kaardi-vastus, mitte URL.
  const [focusPerson, setFocusPerson] = useState<ProsopoMapResponse['focus'] | null>(null);
  const handleFocusChange = useCallback((focus: ProsopoMapResponse['focus'] | null) => {
    setFocusPerson(focus ?? null);
  }, []);
  const clearRelatedTo = () =>
    setSearchParams(p => {
      const n = new URLSearchParams(p);
      n.delete('related_to');
      n.delete(RELATED_SCOPE_PARAM);
      n.delete('focus_place');
      n.delete('offset');
      return n;
    }, { replace: true });
  const toggleRelatedScope = () =>
    setSearchParams(p => {
      const n = new URLSearchParams(p);
      if (n.get(RELATED_SCOPE_PARAM) === RELATED_SCOPE_COLLECTION) n.delete(RELATED_SCOPE_PARAM);
      else n.set(RELATED_SCOPE_PARAM, RELATED_SCOPE_COLLECTION);
      return n;
    }, { replace: true });

  const setOffset = (v: number) =>
    setSearchParams(p => { const n = new URLSearchParams(p); v > 0 ? n.set('offset', String(v)) : n.delete('offset'); return n; }, { replace: true });

  // Liitmise select-mood (ainult admin)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPersons, setSelectedPersons] = useState<ProsopoIndexEntry[]>([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [showMergeModal, setShowMergeModal] = useState(false);


  const isAdmin = isAtLeast(user?.role, 'admin');
  const canEdit = isAtLeast(user?.role, 'editor');
  const token = authToken ?? '';
  const effectiveSelectedCollection = useMemo(() => {
    if (!selectedCollection) return null;
    const collection = collections[selectedCollection];
    if (!collection) return null;
    if (collection.visibility !== 'restricted') return selectedCollection;
    if (isAtLeast(user?.role, 'admin')) return selectedCollection;
    return user?.allowed_collections?.includes(selectedCollection) ? selectedCollection : null;
  }, [collections, selectedCollection, user]);

  /** Aktiivse ulatuse nimi seoste kaardi lüliti jaoks. `null` = otsime kogu VUTT-ist.
   *
   * Lähtub EFEKTIIVSEST ulatusest, mitte päise valikust: kui kasutajal
   * kinnisele kogule ligipääsu ei ole, siis otsing teda ei piira. Sama reegel
   * otsustab, kas kogu-riba (#587, sama mis teoste lehel) üldse näidatakse —
   * nähtamatu piirang tekitas vea, kus kasutaja ei leidnud isikut ja lõi ta
   * uuesti (#240); olematu piirangu näitamine eksitaks teistpidi. */
  const scopeLabel = useMemo(() => {
    const lang = i18n.language === 'en' ? 'en' : 'et';
    if (effectiveSelectedCollection) return getCollectionName(effectiveSelectedCollection, lang);
    if (workSetParam) {
      const set = workSets.find(w => w.id === workSetParam);
      // Sama lahendusahel nagu WorkSetPicker'is: keel → et → en → id.
      return set ? (set.name[lang] || set.name.et || set.name.en || set.id)
                 : t('scope.workSet', 'Töökollektsioon');
    }
    return null;
  }, [effectiveSelectedCollection, getCollectionName, i18n.language, workSetParam, workSets, t]);

  const selectedIds = new Set(selectedPersons.map(p => p.id));

  // Ligipääsu- ja kollektsiooniulatus: selle vahetusel vana loendit ei näidata
  // (#425), sest tema isikud ei pruugi uues ulatuses nähtavad olla.
  const scopeKey = JSON.stringify([effectiveSelectedCollection, workSetParam, user?.username ?? null, token]);

  // Päringu parameetrid ÜHES objektis: võti tuletatakse neist, seega ei saa
  // ükski filter päringu käivitajast välja jääda (#421: origin_place jäi).
  const listParams = {
    q: query || undefined,
    origin_group: originGroup || undefined,
    origin_place: originPlace || undefined,
    institution: institution || undefined,
    source: source || undefined,
    gender: gender || undefined,
    year_from: hasExplicitYearRange && yearFrom ? parseInt(yearFrom) : undefined,
    year_to: hasExplicitYearRange && yearTo ? parseInt(yearTo) : undefined,
    imm_year_from: !hasExplicitYearRange && legacyImmYearFrom ? parseInt(legacyImmYearFrom) : undefined,
    imm_year_to: !hasExplicitYearRange && legacyImmYearTo ? parseInt(legacyImmYearTo) : undefined,
    status_id: statusId || undefined,
    tag: tags.length ? tags : undefined,
    sort_by: sortBy !== 'alpha' ? sortBy : undefined,
    collection: effectiveSelectedCollection || undefined,
    work_set: workSetParam,
    limit: LIMIT,
    offset,
  };
  const personsQuery = useLatestQuery(
    view === 'map' ? null : JSON.stringify(listParams),
    scopeKey,
    () => listPersons(listParams, token),
  );
  const persons = personsQuery.data?.results ?? [];
  const total = personsQuery.data?.total ?? 0;

  const facetParams = {
    q: query || undefined,
    gender: gender || undefined,
    collection: effectiveSelectedCollection || undefined,
    work_set: workSetParam,
  };
  const facetsQuery = useLatestQuery(
    JSON.stringify(facetParams),
    scopeKey,
    () => getPersonFacets(facetParams, token),
  );
  // Vea korral tühjad facetid, nagu varem.
  const facets = facetsQuery.error ? undefined : facetsQuery.data;
  const facetLang = i18n.language?.slice(0, 2) ?? 'et';
  const originGroupFacets = useMemo(() => (facets?.origin_groups || []).map(item => ({
    value: item.value,
    label: item.labels?.[facetLang] ?? item.labels?.['et'] ?? item.labels?.['en'] ?? item.value,
    count: item.count,
  })), [facets, facetLang]);
  const institutionFacets = useMemo(() => (facets?.institutions || []).map(item => ({
    value: item.value,
    label: item.value,
    count: item.count,
  })), [facets]);
  const tagFacets = useMemo(() => (facets?.tags || []).map(item => ({
    value: item.value,
    label: item.labels?.[facetLang] ?? item.labels?.['et'] ?? item.labels?.['en'] ?? item.label,
    count: item.count,
  })), [facets, facetLang]);

  useEffect(() => {
    getVocabularies().then(v => { if (v.seisused) setSeisused(v.seisused); }).catch(() => {});
  }, []);

  const hasActiveFilters = !!(originGroup || originPlace || institution || source || gender || yearFrom || yearTo || statusId || tags.length);
  const activeFilterCount = [originGroup, originPlace, institution, source, gender, yearFrom || yearTo, statusId, tags[0]].filter(Boolean).length;
  const clearAllFilters = () => setSearchParams(p => {
    const n = new URLSearchParams(p);
    ['origin_group', 'origin_place', 'institution', 'source', 'gender', 'year_from', 'year_to', 'imm_year_from', 'imm_year_to', 'status_id', 'tag', 'offset'].forEach(k => n.delete(k));
    return n;
  }, { replace: true });
  const isEn = !!i18n.language?.startsWith('en');
  const statusLabel = (id: string) => {
    const item = seisused.find(s => s.id === id);
    return item ? (isEn ? item.label.en : item.label.et) : id;
  };
  // Leheküljed kuuluvad NÄIDATUD tulemusele, mitte URL-i uuele offsetile:
  // kordusotsingu ajal ei esitata vana koguarvu uue päringu tulemusena (#425).
  const shownOffset = personsQuery.data?.offset ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(shownOffset / LIMIT) + 1;
  const { initialLoading, refreshing } = personsQuery;
  const listError = personsQuery.error ? t('loadError', 'Isikute laadimine ebaõnnestus.') : null;
  // Vana loend on nähtav ainult siis, kui uus päring pole veel vastanud;
  // vea järel teda uue päringu vastuseks ei jäeta.
  const showList = !initialLoading && !listError && personsQuery.data !== undefined;
  // Seoste kaart eirab aktiivset valikut, kui kasutaja seda ise ei piira.
  const mapScope = relatedMapScope(relatedTo, relatedScope, {
    collection: effectiveSelectedCollection || undefined,
    work_set: workSetParam,
  });
  // Kogu-pill ei rakendu ainult kaardivaates; loend ignoreerib related_to-d.
  const mapFilters = {
    q: query || undefined,
    origin_group: originGroup || undefined,
    institution: institution || undefined,
    source: source || undefined,
    gender: gender || undefined,
    year_from: hasExplicitYearRange && yearFrom ? parseInt(yearFrom) : undefined,
    year_to: hasExplicitYearRange && yearTo ? parseInt(yearTo) : undefined,
    imm_year_from: !hasExplicitYearRange && legacyImmYearFrom ? parseInt(legacyImmYearFrom) : undefined,
    imm_year_to: !hasExplicitYearRange && legacyImmYearTo ? parseInt(legacyImmYearTo) : undefined,
    status_id: statusId || undefined,
    tag: tags.length ? tags : undefined,
    related_to: relatedTo || undefined,
    ...mapScope.filters,
  };

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
      personsQuery.reload();
      navigate(`/persons/${result.id}`);
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : t('loadError'));
    } finally {
      setMergeLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-gray-50">
      {/* Lehe nimi on päise navigatsioonis (#587) */}
      <Header />
      {/* Kogu-riba nagu teoste lehel — ainult siis, kui piirang päriselt kehtib */}
      {scopeLabel && <CollectionBar />}

      <main className="max-w-7xl mx-auto px-4 py-4 sm:px-8 sm:py-8">
        {/* Filtrite külgriba + tulemused (#587), peegeldab teoste lehte. Kerib AKEN, külgriba on sticky. */}
        <div className="flex gap-6 items-start">
          <FilterSidebar
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            drawerOpen={filterDrawerOpen}
            onDrawerOpenChange={setFilterDrawerOpen}
            activeCount={activeFilterCount}
          >
            <PersonFilterSections
              yearFrom={yearFrom}
              yearTo={yearTo}
              originGroup={originGroup}
              institution={institution}
              tag={tags[0] ?? ''}
              statusId={statusId}
              gender={gender}
              source={source}
              originGroups={originGroupFacets}
              institutions={institutionFacets}
              tagFacets={tagFacets}
              seisused={seisused}
              onYearFromChange={setYearFrom}
              onYearToChange={setYearTo}
              onOriginGroupChange={setOriginGroup}
              onInstitutionChange={setInstitution}
              onTagChange={setTag}
              onStatusIdChange={setStatusId}
              onGenderChange={setGender}
              onSourceChange={setSource}
            />
          </FilterSidebar>

        <div className="flex-1 min-w-0">
        {/* Otsingurida + mobiilis filtrinupp + uus isik */}
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
              <input
                type="search"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={t('searchPlaceholder', 'Otsi nime järgi…')}
                className={`w-full pl-12 py-3 rounded-lg border border-gray-300 shadow-sm focus:ring-2 focus:ring-primary-100 focus:border-primary-500 outline-none transition-shadow text-lg ${inputValue ? 'pr-10' : 'pr-4'}`}
              />
              {inputValue && (
                <button
                  type="button"
                  onClick={() => { setInputValue(''); setQuery(''); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                  aria-label={t('common:form.clearSearch')}
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <MobileFiltersButton activeCount={activeFilterCount} onClick={() => setFilterDrawerOpen(true)} />
            {canEdit && !selectMode && (
              <Link
                to="/persons/new"
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-3 py-3 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <UserPlus size={16} />
                <span className="hidden sm:inline">{t('addPerson', 'Lisa isik')}</span>
              </Link>
            )}
          </div>

          {/* Aktiivsed filtrid kiipidena — ainult siis, kui mõni on. Kogu on
              kogu-ribal päise all; seoste-filter on esimene kiip. */}
          {(relatedTo || hasActiveFilters) && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {relatedTo && (
                <FilterChip
                  kind={t('map.relationsChip', 'Seosed')}
                  label={<span className="inline-flex items-center gap-1"><Waypoints size={12} />{(focusPerson?.id === relatedTo && focusPerson?.label) || t('map.thisPerson', 'See isik')}</span>}
                  onRemove={clearRelatedTo}
                />
              )}
              {relatedTo && view === 'map' && scopeLabel && (
                <label className="flex items-center gap-1.5 px-2 py-0.5 text-sm text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mapScope.applied}
                    onChange={toggleRelatedScope}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  {t('map.relatedScopeToggle', 'Ainult kogus: {{name}}', { name: scopeLabel })}
                </label>
              )}
              {(yearFrom || yearTo) && (
                <FilterChip kind={t('filterYearRangeShort', 'Aeg')} label={`${yearFrom || '…'} – ${yearTo || '…'}`}
                  onRemove={() => { setYearFrom(''); setYearTo(''); }} />
              )}
              {originPlace && (
                <FilterChip kind={t('originPlaceChip', 'Päritolukoht')} label={originPlace} onRemove={() => setOriginPlace('')} />
              )}
              {originGroup && (
                <FilterChip kind={t('originGroup', 'Päritolu')}
                  label={originGroupFacets.find(g => g.value === originGroup)?.label ?? originGroup}
                  onRemove={() => setOriginGroup('')} />
              )}
              {institution && (
                <FilterChip kind={t('filterInstitutionAll', 'Haridusasutus')} label={institution} onRemove={() => setInstitution('')} />
              )}
              {tags.map(tag => (
                <FilterChip key={tag} kind={t('filterTags')}
                  label={tagFacets.find(f => f.value === tag)?.label ?? tag}
                  onRemove={() => setTag('')} />
              ))}
              {statusId && (
                <FilterChip kind={t('filterStatus', 'Seisus')} label={statusLabel(statusId)} onRemove={() => setStatusId('')} />
              )}
              {gender && (
                <FilterChip kind={t('filterGenderAll', 'Sugu')}
                  label={gender === 'M' ? t('filterMale', 'Meessoost') : t('filterFemale', 'Naissoost')}
                  onRemove={() => setGender('')} />
              )}
              {source && (
                <FilterChip kind={t('filterSourceAll', 'Allikas')}
                  label={source === 'aa' ? t('filterSourceAA', 'Album Academicum') : source}
                  onRemove={() => setSource('')} />
              )}
              {hasActiveFilters && (
                <button type="button" onClick={clearAllFilters} className="text-sm text-gray-500 hover:text-red-600 ml-1">
                  {t('common:filterPanel.clearAll')}
                </button>
              )}
            </div>
          )}
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

        {/* Tulemuste päis — sama kuju nagu teoste lehel */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-6 border-b border-gray-200 pb-3">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-gray-800">{t('common:nav.persons')}</h2>
            {isAdmin && view !== 'map' && (
              <button
                onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  selectMode ? 'bg-primary-100 text-primary-700 font-medium' : 'text-gray-500 hover:bg-gray-100'
                }`}
                title={selectMode ? t('merge.exitSelect', 'Välju valikust') : t('merge.enterSelect', 'Vali liitmiseks')}
              >
                {selectMode ? <CheckSquare size={16} /> : <Square size={16} />}
                {selectMode ? t('merge.exitSelect', 'Tühista') : t('merge.enterSelect', 'Liida')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            {/* Üks püsiv live-piirkond: ekraanilugeja kuuleb „Uuendan…" ja siis
                uue koguarvu. Kordusotsingu ajal vana koguarvu ei näidata, sest see
                ei ole uue päringu tulemus (#425). */}
            {view !== 'map' && (
              <span role="status" aria-live="polite" className="text-sm text-gray-500 min-h-5">
                {refreshing
                  ? <span className="inline-flex items-center gap-1.5 text-primary-600">
                      <span className="h-3 w-3 rounded-full border-2 border-primary-300 border-t-primary-600 animate-spin" aria-hidden="true" />
                      {t('refreshing', 'Uuendan…')}
                    </span>
                  : showList && (shownOffset === 0 && total <= LIMIT
                    ? t('totalCount', '{{count}} isikut', { count: total })
                    : t('filteredCount', '{{filtered}} / {{total}} isikut', { filtered: Math.min(shownOffset + LIMIT, total), total }))}
              </span>
            )}
            {view !== 'map' && (
              <div className="flex items-center gap-1 text-sm">
                <ArrowDownAZ size={15} className="text-gray-400 shrink-0" />
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                  aria-label={t('sortLabel', 'Järjestus')}
                  className="p-1.5 border border-gray-300 rounded text-sm focus:border-primary-500 outline-none bg-white cursor-pointer hover:bg-gray-50"
                >
                  <option value="alpha">{t('sortAlpha', 'A–Z')}</option>
                  <option value="birth_year">{t('sortBirthYear', 'Sünniaasta')}</option>
                  <option value="death_year">{t('sortDeathYear', 'Surmaaasta')}</option>
                  <option value="imm_year">{t('sortImmYear', 'Immatrikuleerumine')}</option>
                </select>
              </div>
            )}
            <ResultsViewToggle
              value={viewValue}
              onChange={handleViewChange}
              groupLabel={t('viewGroup')}
              options={[
                { value: 'cards', icon: LayoutGrid, label: t('viewGrid') },
                { value: 'list', icon: List, label: t('viewList') },
                { value: 'map', icon: MapIcon, label: t('map.view', 'Kaart') },
              ]}
            />
          </div>
        </div>

        {/* Sisu: laadimiskaardid ainult esmalaadimisel (või ulatuse vahetusel) */}
        {view === 'list' && initialLoading && (
          resultsView === 'list' ? (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-16 border-b border-gray-100 last:border-0 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 ${sidebarOpen ? '' : 'xl:grid-cols-4'} gap-6`} aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-64 bg-white border border-gray-200 rounded-lg animate-pulse" />
              ))}
            </div>
          )
        )}

        {view === 'list' && listError && (
          <div className="text-center py-16 text-sm">
            <p className="text-red-600">{listError}</p>
            <button
              type="button"
              onClick={personsQuery.reload}
              className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700 underline"
            >
              {t('retry', 'Proovi uuesti')}
            </button>
          </div>
        )}

        {view === 'list' && showList && persons.length === 0 && (
          <div className={`text-center py-16 text-gray-400 text-sm transition-opacity ${refreshing ? 'opacity-50' : ''}`} aria-busy={refreshing}>
            {query || hasActiveFilters
              ? t('noResults', 'Otsingule vastavaid isikuid ei leitud.')
              : t('empty', 'Prosopograafia andmebaas on tühi.')}
          </div>
        )}

        {view === 'list' && showList && persons.length > 0 && (
          resultsView === 'list' ? (
            <div
              className={`bg-white rounded-lg border border-gray-200 shadow-sm transition-opacity ${refreshing ? 'opacity-50' : ''}`}
              aria-busy={refreshing}
            >
              {persons.map(person => (
                <PersonListRow
                  key={person.id}
                  person={person}
                  selectMode={selectMode}
                  selected={selectedIds.has(person.id)}
                  onSelect={() => toggleSelect(person)}
                  statusVocab={seisused}
                />
              ))}
            </div>
          ) : (
            <div
              className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 ${sidebarOpen ? '' : 'xl:grid-cols-4'} gap-6 transition-opacity ${refreshing ? 'opacity-50' : ''}`}
              aria-busy={refreshing}
            >
              {persons.map(person => (
                <PersonCard
                  key={person.id}
                  person={person}
                  selectMode={selectMode}
                  selected={selectedIds.has(person.id)}
                  onSelect={() => toggleSelect(person)}
                  statusVocab={seisused}
                />
              ))}
            </div>
          )
        )}

        {view === 'map' && (
          <React.Suspense fallback={<div className="h-[640px] rounded-xl border border-gray-200 bg-white" />}>
            <PersonsMap
              filters={mapFilters}
              token={token}
              focusPlace={focusPlace || undefined}
              onFocusChange={handleFocusChange}
            />
          </React.Suspense>
        )}

        {/* Kordusotsingu ajal jääb alles (vaade ei hüppa), aga on inertne:
            tema leheküljed kuuluvad vanale tulemusele. */}
        {view === 'list' && showList && (
          <div inert={refreshing} className={`transition-opacity ${refreshing ? 'opacity-50' : ''}`}>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={(page) => { setOffset((page - 1) * LIMIT); window.scrollTo(0, 0); }}
              className="mt-8 pt-6 border-t border-gray-200"
            />
          </div>
        )}
        </div>
        </div>
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
