import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Plus, X, Loader2, Search } from 'lucide-react';
import { fetchPlaces, fetchPlacesMeta, addPlace, fetchPlaceWikidata } from '../../services/prosopographyService';
import { fetchWithTimeout } from '../../../utils/fetchWithTimeout';
import type { PlaceEntry } from '../../types';

const SHOWN_TYPES = ['city', 'village', 'parish', 'county', 'province', 'territory', 'historical_region'];

async function searchWikidataPlaces(q: string, lang: string): Promise<{ q: string; label: string; description: string; aliases: string[] }[]> {
  if (!q.trim()) return [];
  const params = new URLSearchParams({ action: 'wbsearchentities', search: q, language: lang, format: 'json', type: 'item', limit: '10', origin: '*' });
  try {
    const resp = await fetchWithTimeout(`https://www.wikidata.org/w/api.php?${params}`, { timeout: 10000 });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.search ?? []).map((item: any) => ({ q: item.id, label: item.label ?? '', description: item.description ?? '', aliases: item.aliases ?? [] }));
  } catch { return []; }
}

interface PlacePickerProps {
  value: string | null;
  onChange: (key: string | null) => void;
  token: string;
  canEdit: boolean;
  lang: string;
}

interface AddPlaceModalProps {
  query: string;
  meta: { groups: Record<string, any>; allowed_types: string[] } | null;
  places: Record<string, PlaceEntry>;
  onAdd: (key: string, entry: PlaceEntry) => void;
  onClose: () => void;
  token: string;
}

interface WdPreview {
  q: string;
  proposedKey: string;
  labels: Record<string, string>;
  type: string;
  coordinates?: PlaceEntry['coordinates'];
}

const AddPlaceModal: React.FC<AddPlaceModalProps> = ({ query, meta, places: initialPlaces, onAdd, onClose, token }) => {
  const { t, i18n } = useTranslation('prosopography');
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const wdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parentWdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lokaalne places — kasvab kui lisatakse ülempiirkond
  const [places, setPlaces] = useState(initialPlaces);

  // Wikidata otsing (põhikoht)
  const [wdQuery, setWdQuery] = useState(query);
  const [wdResults, setWdResults] = useState<{ q: string; label: string; description: string; aliases: string[] }[]>([]);
  const [wdSearching, setWdSearching] = useState(false);
  const [wdSelected, setWdSelected] = useState<{ q: string; label: string } | null>(null);
  const [wdParents, setWdParents] = useState<{ q: string; label_en: string; label_sv: string }[]>([]);
  const [wdCoordinates, setWdCoordinates] = useState<PlaceEntry['coordinates'] | null>(null);
  const [wdLoading, setWdLoading] = useState(false);

  // Parent — registriotsing
  const [parentQuery, setParentQuery] = useState('');
  const [parentDropOpen, setParentDropOpen] = useState(false);
  const [parentKey, setParentKey] = useState('');

  // Parent — Wikidata otsing + lisamine
  const [parentWdOpen, setParentWdOpen] = useState(false);
  const [parentWdQuery, setParentWdQuery] = useState('');
  const [parentWdResults, setParentWdResults] = useState<{ q: string; label: string; description: string; aliases: string[] }[]>([]);
  const [parentWdSearching, setParentWdSearching] = useState(false);
  const [parentWdPreview, setParentWdPreview] = useState<WdPreview | null>(null);
  const [parentWdLoading, setParentWdLoading] = useState(false);
  const [parentWdAdding, setParentWdAdding] = useState(false);
  const [parentWdError, setParentWdError] = useState<string | null>(null);

  // Vorm
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [name, setName] = useState(query);
  const [placeType, setPlaceType] = useState('');
  const [qCode, setQCode] = useState('');
  const [group, setGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wdLang = lang === 'et' ? 'en' : lang;

  const resolveLabel = (lbls: Record<string, string> | undefined | null) => {
    if (!lbls) return '';
    return lbls[lang] ?? lbls.et ?? lbls.en ?? Object.values(lbls)[0] ?? '';
  };

  // ── Põhikoha Wikidata otsing ─────────────────────────────────────────────

  const triggerWdSearch = (v: string) => {
    clearTimeout(wdTimer.current);
    if (!v.trim()) { setWdResults([]); return; }
    setWdSearching(true);
    wdTimer.current = setTimeout(async () => {
      const results = await searchWikidataPlaces(v.trim(), wdLang);
      setWdResults(results);
      setWdSearching(false);
    }, 350);
  };

  const handleWdQueryChange = (v: string) => {
    setWdQuery(v);
    setWdSelected(null);
    triggerWdSearch(v);
  };

  const handleSelectWdResult = async (item: { q: string; label: string }) => {
    setWdSelected(item);
    setWdResults([]);
    setWdQuery(item.label);
    setQCode(item.q);
    setWdCoordinates(null);
    setWdLoading(true);
    try {
      const wd = await fetchPlaceWikidata(item.q);
      if (wd.labels && Object.keys(wd.labels).length > 0) {
        setLabels(wd.labels);
        setName(wd.labels.et || wd.labels.en || wd.labels.sv || item.label);
      } else {
        setName(item.label);
      }
      if (wd.type) setPlaceType(wd.type);
      setWdCoordinates(wd.coordinates ?? null);
      setWdParents(wd.parents ?? []);
    } catch {
      setName(item.label);
    } finally {
      setWdLoading(false);
    }
  };

  // ── Ülempiirkonna registriotsing ─────────────────────────────────────────

  const filteredParents = useMemo(() => {
    const q = parentQuery.toLowerCase();
    if (!q) return [];
    return Object.entries(places)
      .filter(([k, e]) => {
        const inLabels = Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q));
        return inLabels || k.toLowerCase().includes(q);
      })
      .slice(0, 10);
  }, [parentQuery, places]);

  const selectParent = (key: string) => {
    setParentKey(key);
    setParentQuery(resolveLabel(places[key]?.labels) || key);
    setParentDropOpen(false);
    setParentWdOpen(false);
    setParentWdPreview(null);
  };

  const handleP131Click = (p: { label_en: string; label_sv: string }) => {
    const label = p.label_sv || p.label_en;
    setParentQuery(label);
    setParentDropOpen(true);
    setParentWdOpen(false);
    const exact = Object.entries(places).find(([, e]) =>
      Object.values(e.labels ?? {}).some(l => l.toLowerCase() === label.toLowerCase())
    );
    if (exact) { selectParent(exact[0]); return; }
    // Ei leitud registrist — ava automaatselt Wikidata otsing
    setParentWdOpen(true);
    setParentWdQuery(label);
    setParentWdResults([]);
    setParentWdPreview(null);
    setParentWdSearching(true);
    searchWikidataPlaces(label, wdLang).then(r => { setParentWdResults(r); setParentWdSearching(false); });
  };

  // ── Ülempiirkonna Wikidata otsing ─────────────────────────────────────────

  const triggerParentWdSearch = (v: string) => {
    clearTimeout(parentWdTimer.current);
    setParentWdPreview(null);
    if (!v.trim()) { setParentWdResults([]); return; }
    setParentWdSearching(true);
    parentWdTimer.current = setTimeout(async () => {
      const results = await searchWikidataPlaces(v.trim(), wdLang);
      setParentWdResults(results);
      setParentWdSearching(false);
    }, 350);
  };

  const handleSelectParentWd = async (item: { q: string; label: string }) => {
    setParentWdResults([]);
    setParentWdQuery(item.label);
    setParentWdLoading(true);
    setParentWdError(null);
    try {
      const wd = await fetchPlaceWikidata(item.q);
      const lbls = Object.keys(wd.labels ?? {}).length > 0 ? wd.labels : { et: item.label, en: item.label };
      const proposedKey = (lbls.et || lbls.en || item.label).replace(/\s+/g, '_');
      setParentWdPreview({ q: item.q, proposedKey, labels: lbls, type: wd.type ?? '', coordinates: wd.coordinates ?? null });
    } catch {
      setParentWdError('Wikidata päring ebaõnnestus');
    } finally {
      setParentWdLoading(false);
    }
  };

  const handleAddParentFromWd = async () => {
    if (!parentWdPreview) return;
    setParentWdAdding(true);
    setParentWdError(null);
    try {
      const result = await addPlace(parentWdPreview.proposedKey, {
        labels: parentWdPreview.labels,
        id: parentWdPreview.q,
        type: parentWdPreview.type || undefined,
        coordinates: parentWdPreview.coordinates ?? undefined,
      }, token);
      setPlaces(prev => ({ ...prev, [result.key]: result.entry }));
      selectParent(result.key);
    } catch (e: any) {
      setParentWdError(e.message ?? 'Lisamine ebaõnnestus');
    } finally {
      setParentWdAdding(false);
    }
  };

  // ── Salvestamine ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!name.trim()) { setError(t('form.nameRequired')); return; }
    const key = name.trim().replace(/\s+/g, '_');
    const finalLabels = Object.keys(labels).length > 0 ? labels : { et: name.trim(), en: name.trim() };
    setSaving(true);
    setError(null);
    try {
      const result = await addPlace(key, {
        labels: finalLabels,
        id: qCode.trim() || null,
        type: placeType || undefined,
        parent_key: parentKey.trim() || undefined,
        group: group || undefined,
        coordinates: wdCoordinates ?? undefined,
      }, token);
      onAdd(result.key, result.entry);
    } catch (e: any) {
      setError(e.message ?? t('form.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900">{t('addPlace')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        {/* Põhikoha Wikidata otsing */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Otsi Wikidatast</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={wdQuery}
              onChange={e => handleWdQueryChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); triggerWdSearch(wdQuery); } }}
              placeholder="nt Gävle, Riga, Westphalia…"
              autoFocus
              className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
            />
            <button type="button" disabled={wdSearching || !wdQuery.trim()}
              onClick={() => { clearTimeout(wdTimer.current); setWdSearching(true); searchWikidataPlaces(wdQuery.trim(), wdLang).then(r => { setWdResults(r); setWdSearching(false); }); }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50">
              {wdSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            </button>
          </div>
          {wdResults.length > 0 && (
            <div className="mt-1 border border-gray-200 rounded-lg shadow-sm max-h-48 overflow-y-auto bg-white">
              {wdResults.map(r => (
                <button key={r.q} type="button" onClick={() => handleSelectWdResult(r)}
                  className="w-full text-left px-3 py-2 hover:bg-primary-50 border-b border-gray-50 last:border-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-900">{r.label}</span>
                    <span className="text-xs font-mono text-gray-400">{r.q}</span>
                  </div>
                  {r.description && <p className="text-xs text-gray-500 mt-0.5">{r.description}</p>}
                  {r.aliases?.length > 0 && <p className="text-xs text-gray-400 mt-0.5 italic">{r.aliases.slice(0, 4).join(', ')}</p>}
                </button>
              ))}
            </div>
          )}
          {wdSelected && wdLoading && (
            <p className="mt-1 text-xs text-gray-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Laen detailid…</p>
          )}
          {wdSelected && !wdLoading && wdCoordinates && (
            <p className="mt-1 text-xs text-green-700">
              Koordinaadid Wikidatast: {wdCoordinates.lat.toFixed(5)}, {wdCoordinates.lon.toFixed(5)}
            </p>
          )}
          {wdSelected && !wdLoading && wdParents.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">Ülempiirkond Wikidatast — klõps otsib registrist:</p>
              {wdParents.map(p => (
                <button key={p.q} type="button" onClick={() => handleP131Click(p)}
                  className="mr-1 mb-1 px-2 py-0.5 text-xs border border-blue-200 text-blue-700 rounded hover:bg-blue-50">
                  {p.label_sv || p.label_en} <span className="text-gray-400">({p.q})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 pt-3 space-y-3">
          {Object.keys(labels).length > 0 && (
            <div className="bg-gray-50 rounded p-2 text-xs text-gray-600 space-y-0.5">
              {Object.entries(labels).map(([l, lbl]) => (
                <div key={l}><span className="font-mono text-gray-400 w-5 inline-block">{l}</span> {lbl}</div>
              ))}
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nimi registris *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Tüüp</label>
              <select value={placeType} onChange={e => setPlaceType(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none">
                <option value="">—</option>
                {(meta?.allowed_types ?? []).map(tp => <option key={tp} value={tp}>{tp}</option>)}
              </select>
            </div>
            <div className="w-32">
              <label className="block text-xs text-gray-500 mb-1">Q-kood</label>
              <input type="text" value={qCode} onChange={e => setQCode(e.target.value)}
                placeholder="Q12345"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono" />
            </div>
          </div>
          {!qCode.trim() && <p className="text-xs text-amber-600">{t('noQCode')}</p>}

          {/* Ülempiirkond */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Ülempiirkond (valikuline)</label>

            {/* Registriotsing */}
            <div className="relative">
              <input
                type="text"
                value={parentKey ? `${parentQuery} (${parentKey})` : parentQuery}
                onChange={e => {
                  const v = e.target.value;
                  setParentQuery(v);
                  setParentKey('');
                  setParentDropOpen(true);
                  setParentWdPreview(null);
                }}
                onFocus={() => { if (!parentKey) setParentDropOpen(true); }}
                onBlur={() => setTimeout(() => setParentDropOpen(false), 150)}
                placeholder="Otsi olemasolevat piirkonda…"
                readOnly={!!parentKey}
                className={`w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-primary-500 outline-none ${parentKey ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-300'}`}
              />
              {parentKey && (
                <button type="button" onClick={() => { setParentKey(''); setParentQuery(''); setParentWdPreview(null); }}
                  className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600">
                  <X size={13} />
                </button>
              )}
              {parentDropOpen && !parentKey && filteredParents.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {filteredParents.map(([k, e]) => (
                    <button key={k} type="button" onMouseDown={() => selectParent(k)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-primary-50 border-b border-gray-50 last:border-0 flex items-baseline gap-2">
                      <span className="font-medium">{resolveLabel(e.labels)}</span>
                      {e.type && <span className="text-xs text-gray-400">({e.type})</span>}
                      <span className="ml-auto text-xs font-mono text-gray-300">{k}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Wikidata otsingulüliti */}
            {!parentKey && (
              <button type="button"
                onClick={() => { setParentWdOpen(v => !v); setParentWdResults([]); setParentWdPreview(null); setParentWdError(null); }}
                className="mt-1.5 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Search size={11} />
                {parentWdOpen ? 'Peida Wikidata otsing' : 'Otsi Wikidatast'}
              </button>
            )}

            {/* Ülempiirkonna Wikidata otsing */}
            {parentWdOpen && !parentKey && (
              <div className="mt-2 bg-blue-50 border border-blue-200 rounded p-2.5 space-y-2">
                <div className="flex gap-2">
                  <input type="text" value={parentWdQuery}
                    onChange={e => { setParentWdQuery(e.target.value); triggerParentWdSearch(e.target.value); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); triggerParentWdSearch(parentWdQuery); } }}
                    placeholder="nt Gästrikland, Livonia…"
                    className="flex-1 px-2 py-1 text-sm border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white"
                  />
                  <button type="button" disabled={parentWdSearching || !parentWdQuery.trim()}
                    onClick={() => { clearTimeout(parentWdTimer.current); setParentWdSearching(true); searchWikidataPlaces(parentWdQuery.trim(), wdLang).then(r => { setParentWdResults(r); setParentWdSearching(false); }); }}
                    className="flex items-center px-2 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                    {parentWdSearching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                  </button>
                </div>
                {parentWdResults.length > 0 && (
                  <div className="border border-blue-200 rounded bg-white max-h-36 overflow-y-auto">
                    {parentWdResults.map(r => (
                      <button key={r.q} type="button" onClick={() => handleSelectParentWd(r)}
                        className="w-full text-left px-2.5 py-1.5 hover:bg-blue-50 border-b border-gray-50 last:border-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-gray-900">{r.label}</span>
                          <span className="text-xs font-mono text-gray-400">{r.q}</span>
                        </div>
                        {r.description && <p className="text-xs text-gray-500">{r.description}</p>}
                      </button>
                    ))}
                  </div>
                )}
                {parentWdLoading && <p className="text-xs text-gray-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Laen…</p>}
                {parentWdPreview && !parentWdLoading && (
                  <div className="bg-white border border-blue-300 rounded p-2 space-y-1">
                    <div className="text-xs text-gray-600 space-y-0.5">
                      {Object.entries(parentWdPreview.labels).map(([l, lbl]) => (
                        <div key={l}><span className="font-mono text-gray-400 w-5 inline-block">{l}</span> {lbl}</div>
                      ))}
                      <div className="text-gray-400 mt-0.5">
                        võti: <span className="font-mono">{parentWdPreview.proposedKey}</span>
                        {parentWdPreview.type && <span className="ml-2">tüüp: {parentWdPreview.type}</span>}
                      </div>
                    </div>
                    {parentWdError && <p className="text-xs text-red-600">{parentWdError}</p>}
                    <button type="button" onClick={handleAddParentFromWd} disabled={parentWdAdding}
                      className="w-full px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                      {parentWdAdding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                      Lisa ülempiirkond registrisse
                    </button>
                  </div>
                )}
                {parentWdError && !parentWdPreview && <p className="text-xs text-red-600">{parentWdError}</p>}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Grupp (valikuline)</label>
            <select value={group} onChange={e => setGroup(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none">
              <option value="">—</option>
              {Object.entries(meta?.groups ?? {})
                .filter(([, v]: any) => !v.parent)
                .sort((a: any, b: any) => (a[1].sort_order ?? 50) - (b[1].sort_order ?? 50))
                .map(([k, v]: any) => (
                  <option key={k} value={k}>{v.labels?.et ?? k}</option>
                ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Tühista</button>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-60">
            {saving ? '…' : 'Lisa'}
          </button>
        </div>
      </div>
    </div>
  );
};

const PlacePicker: React.FC<PlacePickerProps> = ({ value, onChange, token, canEdit, lang }) => {
  const { t } = useTranslation('prosopography');
  const [places, setPlaces] = useState<Record<string, PlaceEntry>>({});
  const [meta, setMeta] = useState<{ groups: Record<string, any>; allowed_types: string[] } | null>(null);
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchPlaces().then(setPlaces).catch(() => {});
    fetchPlacesMeta().then(setMeta).catch(() => {});
  }, []);

  const selectedEntry = value ? places[value] : null;

  const resolveLabel = (labels: Record<string, string> | undefined | null): string => {
    if (!labels) return '';
    return labels[lang] ?? labels['et'] ?? labels['en'] ?? Object.values(labels)[0] ?? '';
  };

  const displayLabel = selectedEntry ? resolveLabel(selectedEntry.labels) : (value ?? '');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return [];
    return Object.entries(places)
      .filter(([, e]) => SHOWN_TYPES.includes(e.type ?? ''))
      .filter(([k, e]) => {
        const inLabels = Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q));
        const inHistorical = (e.historical_names ?? []).some((n: string) => n.toLowerCase().includes(q));
        return inLabels || inHistorical || k.toLowerCase().includes(q);
      })
      .slice(0, 12);
  }, [query, places]);

  const handleSelect = (key: string) => {
    onChange(key);
    setQuery('');
    setShowDropdown(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery('');
  };

  const resolvedGroup = (() => {
    if (!selectedEntry) return null;
    if (selectedEntry.group) {
      const g = meta?.groups[selectedEntry.group];
      return g?.labels ? resolveLabel(g.labels) : selectedEntry.group;
    }
    const pk = selectedEntry.parent_key;
    if (pk) {
      const parentEntry = places[pk];
      if (parentEntry?.group) {
        const g = meta?.groups[parentEntry.group];
        return g?.labels ? resolveLabel(g.labels) : parentEntry.group;
      }
    }
    return null;
  })();

  return (
    <div className="relative">
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
        <MapPin size={11} className="inline mr-1 text-primary-600" />
        {t('originPlace')}
      </label>

      {value ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded bg-gray-50 text-gray-800">
            {displayLabel}
          </span>
          <button onClick={handleClear} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X size={14} />
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder="Otsi linna, kihelkonda, piirkonda…"
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
        />
      )}

      {resolvedGroup && value && (
        <p className="mt-0.5 text-xs text-gray-400">{t('placeGroup', { group: resolvedGroup })}</p>
      )}

      {showDropdown && query && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(([key, entry]) => (
            <button key={key}
              className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-primary-50 border-b border-gray-50 last:border-0"
              onMouseDown={() => handleSelect(key)}>
              <span className="font-medium">{resolveLabel(entry.labels)}</span>
              {entry.type && <span className="ml-1.5 text-xs text-gray-400">({entry.type})</span>}
            </button>
          ))}
          {canEdit && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 flex items-center gap-1.5 border-t border-gray-100"
              onMouseDown={() => { setShowDropdown(false); setShowAddModal(true); }}>
              <Plus size={13} />
              {t('addPlace')}
            </button>
          )}
          {filtered.length === 0 && !canEdit && (
            <p className="px-3 py-2 text-sm text-gray-400 italic">Ei leitud. Paluge editoril lisada.</p>
          )}
        </div>
      )}

      {showAddModal && (
        <AddPlaceModal
          query={query}
          meta={meta}
          places={places}
          token={token}
          onAdd={(key, entry) => {
            setPlaces(prev => ({ ...prev, [key]: entry }));
            handleSelect(key);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
};

export default PlacePicker;
