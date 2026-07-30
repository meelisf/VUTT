import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { isAtLeast } from '../../utils/roleUtils';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2, Search, Plus, Settings, X } from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { fetchPlaces, fetchPlacesMeta } from '../../prosopography/services/prosopographyService';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { FILE_API_URL } from '../../config';
import type { PlaceEntry } from '../../prosopography/types';
import { buildPlacesTree } from './placesTreeUtils';
import PlacesTree from './PlacesTree';
import PlacesDetail from './PlacesDetail';
import PlacesGroupPanel from './PlacesGroupPanel';
import AddPlaceModal from '../../prosopography/components/AddPlaceModal';
import UnsavedChangesDialog from '../../components/UnsavedChangesDialog';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';

const MAX_PERSON_SAMPLE = 5;

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

const Places: React.FC = () => {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const { user, authToken, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [places, setPlaces] = useState<Record<string, PlaceEntry>>({});
  const [meta, setMeta] = useState<{ groups: Record<string, any>; allowed_types: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const placeSaveRef = useRef<(() => Promise<boolean>) | null>(null);

  const handleGuardSave = useCallback(async (): Promise<boolean> => {
    if (!placeSaveRef.current) return true;
    return placeSaveRef.current();
  }, []);

  const { dialogProps, runGuarded } = useUnsavedChangesGuard({
    isDirty,
    onSave: handleGuardSave,
  });

  const [personCounts, setPersonCounts] = useState<Record<string, number>>({});
  const [personSamples, setPersonSamples] = useState<
    Record<string, { id: string; name: string; imm_year?: number | null }[]>
  >({});

  useEffect(() => {
    if (!userLoading && (!user || !isAtLeast(user.role, 'admin'))) navigate('/');
  }, [user, userLoading, navigate]);

  useEffect(() => {
    if (!authToken) return;
    setLoading(true);
    Promise.all([fetchPlaces(), fetchPlacesMeta()])
      .then(([p, m]) => { setPlaces(p); setMeta(m); })
      .catch(() => setLoadError(t('places.loadError')))
      .finally(() => setLoading(false));
  }, [authToken]);

  useEffect(() => {
    if (!authToken || Object.keys(places).length === 0) return;
    fetchWithTimeout(`${FILE_API_URL}/prosopography?limit=5000`, {
      headers: getAuthHeaders(authToken),
    })
      .then(r => r.json())
      .then((data: any) => {
        const counts: Record<string, number> = {};
        const samples: Record<string, { id: string; name: string; imm_year?: number | null }[]> = {};
        for (const entry of (data.results ?? [])) {
          const pk = entry.origin_place;
          if (!pk) continue;
          counts[pk] = (counts[pk] ?? 0) + 1;
          if (!samples[pk]) samples[pk] = [];
          if (samples[pk].length < MAX_PERSON_SAMPLE) {
            samples[pk].push({
              id: entry.id,
              name: entry.label ?? entry.id,
              imm_year: entry.imm_year ?? null,
            });
          }
        }
        setPersonCounts(counts);
        setPersonSamples(samples);
      })
      .catch(() => {});
  }, [authToken, places]);

  const treeGroups = useMemo(() => buildPlacesTree(places, meta?.groups ?? {}), [places, meta]);

  const searchResults = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return null;
    return Object.entries(places).filter(([k, e]) => {
      const inLabels = Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q));
      const inHist = (e.historical_names ?? []).some((n: string) => n.toLowerCase().includes(q));
      return inLabels || inHist || k.toLowerCase().includes(q);
    });
  }, [searchQuery, places]);

  const handleUpdated = useCallback((key: string, entry: PlaceEntry) => {
    setPlaces(prev => ({ ...prev, [key]: entry }));
  }, []);

  const handleMerged = useCallback((sourceKey: string, _targetKey: string) => {
    setPlaces(prev => {
      const next = { ...prev };
      delete next[sourceKey];
      return next;
    });
    setSelectedKey(null);
  }, []);

  const handleDeleted = useCallback((key: string) => {
    setPlaces(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSelectedKey(null);
  }, []);

  const handleGroupsChanged = useCallback((updated: Record<string, any>) => {
    if ('__reload' in updated) {
      fetchPlacesMeta().then(m => setMeta(m)).catch(() => {});
      return;
    }
    setMeta(prev => prev ? { ...prev, groups: updated } : prev);
  }, []);

  const handleSelectKey = useCallback((key: string | null) => {
    if (key === selectedKey) return;
    runGuarded(() => setSelectedKey(key));
  }, [runGuarded, selectedKey]);

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!isAtLeast(user.role, 'admin')) return null;

  const selectedEntry = selectedKey ? places[selectedKey] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('places.tab')} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Otsingubaar */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('places.search')}
              className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400 min-w-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-gray-400 hover:text-gray-600 shrink-0"
                aria-label={t('places.clearSearch')}
              >
                <X size={14} />
              </button>
            )}
            <button
              onClick={() => setShowGroupPanel(s => !s)}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded border ${showGroupPanel ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}
            >
              <Settings size={14} />
              {t('places.groups')}
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 shrink-0"
            >
              <Plus size={14} />
              {t('places.addPlace')}
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
          ) : loadError ? (
            <p className="p-6 text-sm text-red-600">{loadError}</p>
          ) : (
            <div className="flex" style={{ height: 'calc(100vh - 220px)' }}>
              {/* Vasak: puu / otsingutulemused */}
              <div className="w-64 border-r border-gray-100 overflow-y-auto shrink-0">
                {showGroupPanel && meta && (
                  <PlacesGroupPanel
                    groups={meta.groups}
                    token={authToken!}
                    lang={lang}
                    onGroupsChanged={handleGroupsChanged}
                    onClose={() => setShowGroupPanel(false)}
                  />
                )}
                {searchResults ? (
                  <div className="py-2">
                    {searchResults.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-gray-400 italic">{t('places.noSearchResults')}</p>
                    ) : (
                      searchResults.map(([k, e]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => handleSelectKey(k)}
                          className={`w-full text-left px-3 py-1.5 text-sm flex items-baseline gap-2 rounded mx-1
                            ${selectedKey === k ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                        >
                          <span className="truncate flex-1">{resolveLabel(e.labels, lang)}</span>
                          {e.type && <span className="text-xs text-gray-400 shrink-0">{t(`places.types.${e.type}`, e.type)}</span>}
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <PlacesTree
                    groups={treeGroups}
                    selectedKey={selectedKey}
                    onSelect={handleSelectKey}
                    lang={lang}
                  />
                )}
              </div>

              {/* Parem: detailpaneel */}
              <div className="flex-1 overflow-y-auto">
                {selectedEntry ? (
                  <PlacesDetail
                    placeKey={selectedKey!}
                    entry={selectedEntry}
                    places={places}
                    meta={meta}
                    personCount={personCounts[selectedKey!] ?? 0}
                    personSample={personSamples[selectedKey!] ?? []}
                    token={authToken ?? ''}
                    lang={lang}
                    onUpdated={handleUpdated}
                    onMerged={handleMerged}
                    onDeleted={handleDeleted}
                    onSelectKey={handleSelectKey}
                    onDirtyChange={setIsDirty}
                    saveRef={placeSaveRef}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-gray-400 italic">
                    {t('places.selectPrompt')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddPlaceModal
          query=""
          meta={meta}
          places={places}
          token={authToken ?? ''}
          onAdd={(key, entry) => {
            setPlaces(prev => ({ ...prev, [key]: entry }));
            setShowAddModal(false);
            // Ka uue koha loomine vahetab valikut — see peab käima guardist läbi,
            // muidu kaoks pooleliolev muudatus vaikselt.
            handleSelectKey(key);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      <UnsavedChangesDialog {...dialogProps} />
    </div>
  );
};

export default Places;
