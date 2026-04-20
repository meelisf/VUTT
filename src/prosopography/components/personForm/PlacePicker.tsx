import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Plus, X, Loader2, Search } from 'lucide-react';
import { fetchPlaces, fetchPlacesMeta, addPlace, fetchPlaceWikidata } from '../../services/prosopographyService';
import type { PlaceEntry } from '../../types';

const SHOWN_TYPES = ['city', 'village', 'parish', 'county', 'province', 'territory', 'historical_region'];

interface PlacePickerProps {
  value: string | null;          // places.json võti
  onChange: (key: string | null) => void;
  token: string;
  canEdit: boolean;              // editor/admin
  lang: string;
}

interface AddPlaceModalProps {
  query: string;
  meta: { groups: Record<string, any>; allowed_types: string[] } | null;
  onAdd: (key: string, entry: PlaceEntry) => void;
  onClose: () => void;
  token: string;
}

const AddPlaceModal: React.FC<AddPlaceModalProps> = ({ query, meta, onAdd, onClose, token }) => {
  const { t } = useTranslation('prosopography');
  const [name, setName] = useState(query);
  const [labels, setLabels] = useState<Record<string, string>>({ et: query, en: query });
  const [placeType, setPlaceType] = useState('');
  const [qCode, setQCode] = useState('');
  const [parentKey, setParentKey] = useState('');
  const [group, setGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wdLoading, setWdLoading] = useState(false);
  const [wdParents, setWdParents] = useState<{ q: string; label_en: string; label_sv: string }[]>([]);

  const handleFetchWikidata = async () => {
    const qid = qCode.trim();
    if (!qid.match(/^Q\d+$/)) { setError('Sisesta korrektne Q-kood (nt Q25748)'); return; }
    setWdLoading(true);
    setError(null);
    try {
      const wd = await fetchPlaceWikidata(qid);
      if (wd.labels && Object.keys(wd.labels).length > 0) {
        setLabels(wd.labels);
        setName(wd.labels.et || wd.labels.en || wd.labels.sv || name);
      }
      if (wd.type) setPlaceType(wd.type);
      setWdParents(wd.parents ?? []);
    } catch (e: any) {
      setError('Wikidata päring ebaõnnestus: ' + (e.message ?? ''));
    } finally {
      setWdLoading(false);
    }
  };

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
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900">{t('addPlace')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('form.nameLabel')} *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tüüp</label>
            <select value={placeType} onChange={e => setPlaceType(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none">
              <option value="">—</option>
              {(meta?.allowed_types ?? []).map(tp => <option key={tp} value={tp}>{tp}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Wikidata Q-kood (valikuline)</label>
            <div className="flex gap-1.5">
              <input type="text" value={qCode} onChange={e => setQCode(e.target.value)}
                placeholder="Q25748"
                className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono" />
              <button type="button" onClick={handleFetchWikidata} disabled={wdLoading || !qCode.trim().match(/^Q\d+$/)}
                className="flex items-center gap-1 px-2 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors whitespace-nowrap"
                title="Päri andmed Wikidatast">
                {wdLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                WD
              </button>
            </div>
            {!qCode.trim() && <p className="mt-1 text-xs text-amber-600">{t('noQCode')}</p>}
            {Object.keys(labels).length > 0 && qCode.trim() && (
              <div className="mt-1.5 text-xs text-gray-500 space-y-0.5">
                {Object.entries(labels).map(([lang, lbl]) => (
                  <div key={lang}><span className="font-mono text-gray-400">{lang}:</span> {lbl}</div>
                ))}
              </div>
            )}
            {wdParents.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1">P131 ülempiirkond — vali parent_key aluseks:</p>
                {wdParents.map(p => (
                  <button key={p.q} type="button"
                    onClick={() => setParentKey(p.label_sv || p.label_en)}
                    className="mr-1 mb-1 px-2 py-0.5 text-xs border border-blue-200 text-blue-700 rounded hover:bg-blue-50">
                    {p.label_sv || p.label_en} ({p.q})
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Ülem-koht (parent_key, valikuline)</label>
            <input type="text" value={parentKey} onChange={e => setParentKey(e.target.value)}
              placeholder="Livland"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Grupp (valikuline)</label>
            <select value={group} onChange={e => setGroup(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none">
              <option value="">—</option>
              {Object.entries(meta?.groups ?? {}).map(([k, v]: any) => (
                <option key={k} value={k}>{v.labels?.et ?? k}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
            Tühista
          </button>
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
        const inKey = k.toLowerCase().includes(q);
        return inLabels || inHistorical || inKey;
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
    const entry = selectedEntry;
    if (entry.group) {
      const g = meta?.groups[entry.group];
      return g?.labels ? resolveLabel(g.labels) : entry.group;
    }
    const parentKey = entry.parent_key;
    if (parentKey) {
      const parentEntry = places[parentKey];
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
        <p className="mt-0.5 text-xs text-gray-400">
          {t('placeGroup', { group: resolvedGroup })}
        </p>
      )}

      {showDropdown && query && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(([key, entry]) => (
            <button
              key={key}
              className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-primary-50 border-b border-gray-50 last:border-0"
              onMouseDown={() => handleSelect(key)}
            >
              <span className="font-medium">{resolveLabel(entry.labels)}</span>
              {entry.type && <span className="ml-1.5 text-xs text-gray-400">({entry.type})</span>}
            </button>
          ))}
          {canEdit && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 flex items-center gap-1.5 border-t border-gray-100"
              onMouseDown={() => { setShowDropdown(false); setShowAddModal(true); }}
            >
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
