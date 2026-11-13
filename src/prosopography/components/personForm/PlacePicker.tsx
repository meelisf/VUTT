import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Plus, X } from 'lucide-react';
import { fetchPlaces, fetchPlacesMeta } from '../../services/prosopographyService';
import type { PlaceEntry } from '../../types';
import AddPlaceModal from '../AddPlaceModal';
import WikidataPlaceSearch from '../WikidataPlaceSearch';
import type { PlaceSuggestion, WikidataPlace } from '../../services/prosopographyService';
import type { LinkedEntity } from '../../../types/LinkedEntity';

const SHOWN_TYPES = ['city', 'village', 'parish', 'county', 'province', 'territory', 'historical_region'];

interface PlacePickerProps {
  value: string | null;
  onChange: (key: string | null, entry?: PlaceEntry) => void;
  fallback?: LinkedEntity | null;
  token: string;
  canEdit: boolean;
  lang: string;
  label?: string;
}

const PlacePicker: React.FC<PlacePickerProps> = ({ value, onChange, token, canEdit, lang, label, fallback }) => {
  const { t } = useTranslation('prosopography');
  const [places, setPlaces] = useState<Record<string, PlaceEntry>>({});
  const [meta, setMeta] = useState<{ groups: Record<string, any>; allowed_types: string[] } | null>(null);
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selection, setSelection] = useState<{ item: PlaceSuggestion; details: WikidataPlace }>();
  const [loadError, setLoadError] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  useEffect(() => {
    fetchPlaces().then(setPlaces).catch(() => setLoadError(true)).finally(() => setRegisterLoading(false));
    fetchPlacesMeta().then(setMeta).catch(() => {});
  }, []);

  const selectedKey = value || (fallback?.id ? Object.keys(places).find(k => places[k].id === fallback.id) : null);
  const selectedEntry = selectedKey ? places[selectedKey] : null;

  const resolveLabel = (labels: Record<string, string> | undefined | null): string => {
    if (!labels) return '';
    return labels[lang] ?? labels['et'] ?? labels['en'] ?? Object.values(labels)[0] ?? '';
  };

  const displayLabel = selectedEntry ? resolveLabel(selectedEntry.labels) : (value || fallback?.label || '');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return [];
    return Object.entries(places)
      .filter(([, e]) => !e.type || SHOWN_TYPES.includes(e.type))
      .filter(([k, e]) => {
        const inLabels = Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q));
        const inHistorical = (e.historical_names ?? []).some((n: string) => n.toLowerCase().includes(q));
        return inLabels || inHistorical || k.toLowerCase().includes(q) || e.id?.toLowerCase() === q;
      })
      .slice(0, 12);
  }, [query, places]);

  const handleSelect = (key: string, entry = places[key]) => {
    onChange(key, entry);
    setQuery('');
    setShowDropdown(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery('');
  };

  const resolvedGroup = (() => {
    if (!selectedEntry) return null;
    const seen = new Set<PlaceEntry>();
    let entry: PlaceEntry | undefined = selectedEntry;
    while (entry && !seen.has(entry)) {
      seen.add(entry);
      if (entry.group) {
        const group = meta?.groups[entry.group];
        return group?.labels ? resolveLabel(group.labels) : entry.group;
      }
      entry = entry.parent_key ? places[entry.parent_key] : undefined;
    }
    return null;
  })();

  return (
    <div className="relative" ref={containerRef} onBlur={e => {
      // Disabling a selected result during its detail lookup may remove focus.
      // A null relatedTarget must not unmount that in-flight lookup.
      if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setShowDropdown(false);
    }}>
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
        <MapPin size={11} className="inline mr-1 text-primary-600" />
        {label ?? t('origin')}
      </label>

      {value || fallback ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded bg-gray-50 text-gray-800">
            {displayLabel}
          </span>
          <button type="button" aria-label={t('place.clear')} onClick={handleClear} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X size={14} />
          </button>
        </div>
      ) : (
        <input
          type="text"
          aria-label={label ?? t('origin')}
          value={query}
          onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          placeholder={t('place.searchPlaceholder')}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
        />
      )}

      {resolvedGroup && (value || fallback) && (
        <p className="mt-0.5 text-xs text-gray-400">{t('placeGroup', { group: resolvedGroup })}</p>
      )}

      {loadError && <p role="alert" className="text-xs text-red-600">{t('place.registryError')}</p>}
      {showDropdown && query && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          <p className="px-3 pt-2 text-xs text-gray-500">{t('place.registry')}</p>
          {filtered.map(([key, entry]) => (
            <button type="button" key={key}
              className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-primary-50 border-b border-gray-50 last:border-0"
              onClick={() => handleSelect(key)}>
              <span className="font-medium">{resolveLabel(entry.labels)}</span>
              {entry.type && <span className="ml-1.5 text-xs text-gray-400">({entry.type})</span>}
            </button>
          ))}
          {canEdit && !loadError && !registerLoading && <div className="p-2 border-t">
            <p className="mb-1 text-xs text-gray-500">Wikidata</p>
            <WikidataPlaceSearch query={query} lang={lang} onSelect={(item, details) => {
              const existing = Object.entries(places).find(([, e]) => e.id === item.q);
              if (existing) { handleSelect(existing[0]); return; }
              setSelection({ item, details });
              setShowDropdown(false);
              setShowAddModal(true);
            }} />
          </div>}
          {canEdit && !loadError && !registerLoading && (
            <button type="button"
              className="w-full text-left px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 flex items-center gap-1.5 border-t border-gray-100"
              onClick={() => { setSelection(undefined); setShowDropdown(false); setShowAddModal(true); }}>
              <Plus size={13} />
              {t('addPlace')}
            </button>
          )}
          {filtered.length === 0 && !canEdit && (
            <p className="px-3 py-2 text-sm text-gray-400 italic">{t('place.notFound')}</p>
          )}
        </div>
      )}

      {showAddModal && (
        <AddPlaceModal
          query={query}
          initialSelection={selection}
          meta={meta}
          places={places}
          token={token}
          onAdd={(key, entry) => {
            setPlaces(prev => ({ ...prev, [key]: entry }));
            handleSelect(key, entry);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
};

export default PlacePicker;
