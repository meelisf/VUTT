import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Edit2, GitMerge, Trash2, Loader2, X, Plus } from 'lucide-react';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import { icon } from 'leaflet';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { updatePlace, deletePlace } from '../../prosopography/services/prosopographyService';
import type { PlaceEntry } from '../../prosopography/types';
import PlacesMergeModal from './PlacesMergeModal';

const PLACE_TYPES = ['city', 'village', 'parish', 'county', 'province', 'territory', 'historical_region'];
const LANGS = ['et', 'en', 'de', 'la', 'sv'];

const ZOOM_BY_TYPE: Record<string, number> = {
  city: 9, village: 9, parish: 9,
  county: 6, province: 6, territory: 6, historical_region: 6,
};

const DEFAULT_MARKER = icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  shadowSize: [41, 41],
  popupAnchor: [1, -34],
});

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

/** Vormi mustand — üks objekt, et baasseisuga võrdlemine oleks üks võrdlus. */
interface PlaceFormDraft {
  labels: Record<string, string>;
  placeType: string;
  qCode: string;
  parentKey: string;
  group: string;
  historicalNames: string[];
  lat: string;
  lon: string;
  notes: string;
}

/**
 * Normaliseerib mustandi võrdluseks. Ilma selleta annaks `undefined` vs tühi string,
 * puuduv võti vs tühi objekt ja trimmimata sisestus valepositiivse dirty-lipu.
 */
function normalizeDraft(d: PlaceFormDraft): string {
  const labels = Object.fromEntries(
    Object.entries(d.labels)
      .map(([k, v]) => [k, v.trim()])
      .filter(([, v]) => v !== '')
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({
    labels,
    placeType: d.placeType.trim(),
    qCode: d.qCode.trim(),
    parentKey: d.parentKey.trim(),
    group: d.group.trim(),
    historicalNames: d.historicalNames.map(n => n.trim()).filter(n => n !== ''),
    lat: d.lat.trim(),
    lon: d.lon.trim(),
    notes: d.notes.trim(),
  });
}

/** Baasseis kirjest: sama kuju, mis vorm avamisel saab. */
function draftFromEntry(entry: PlaceEntry): PlaceFormDraft {
  return {
    labels: { ...(entry.labels ?? {}) },
    placeType: entry.type ?? '',
    qCode: entry.id ?? '',
    parentKey: entry.parent_key ?? '',
    group: entry.group ?? '',
    historicalNames: [...(entry.historical_names ?? [])],
    lat: entry.coordinates?.lat != null ? String(entry.coordinates.lat) : '',
    lon: entry.coordinates?.lon != null ? String(entry.coordinates.lon) : '',
    notes: entry.notes ?? '',
  };
}

interface PlacesDetailProps {
  placeKey: string;
  entry: PlaceEntry;
  places: Record<string, PlaceEntry>;
  meta: { groups: Record<string, any>; allowed_types: string[] } | null;
  personCount: number;
  personSample: { id: string; name: string; imm_year?: number | null }[];
  token: string;
  lang: string;
  onUpdated: (key: string, entry: PlaceEntry) => void;
  onMerged: (sourceKey: string, targetKey: string) => void;
  onDeleted: (key: string) => void;
  onSelectKey: (key: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Vanem paneb siia salvestusfunktsiooni, et dialoog saaks seda kutsuda. */
  saveRef?: React.MutableRefObject<(() => Promise<boolean>) | null>;
}

const PlacesDetail: React.FC<PlacesDetailProps> = ({
  placeKey, entry, places, meta, personCount, personSample,
  token, lang, onUpdated, onMerged, onDeleted, onSelectKey, onDirtyChange, saveRef,
}) => {
  const { t } = useTranslation('admin');
  const [editing, setEditing] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Edit form state
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [placeType, setPlaceType] = useState('');
  const [qCode, setQCode] = useState('');
  const [parentKey, setParentKey] = useState('');
  const [parentQuery, setParentQuery] = useState('');
  const [parentDropOpen, setParentDropOpen] = useState(false);
  const [group, setGroup] = useState('');
  const [historicalNames, setHistoricalNames] = useState<string[]>([]);
  const [newHistName, setNewHistName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');

  const parseDMS = (raw: string): { lat?: number; lon?: number } | null => {
    const re = /(\d+)°\s*(\d+)[''']\s*(\d+(?:[.,]\d+)?)["""]\s*([NSEWnsew])/g;
    const matches = [...raw.matchAll(re)];
    if (!matches.length) return null;
    const toDecimal = (d: string, m: string, s: string, dir: string) => {
      const v = parseInt(d) + parseInt(m) / 60 + parseFloat(s.replace(',', '.')) / 3600;
      return Math.round(v * 1e6) / 1e6 * ('SWsw'.includes(dir) ? -1 : 1);
    };
    const result: { lat?: number; lon?: number } = {};
    for (const [, d, m, s, dir] of matches) {
      if ('NSns'.includes(dir)) result.lat = toDecimal(d, m, s, dir);
      else result.lon = toDecimal(d, m, s, dir);
    }
    return Object.keys(result).length ? result : null;
  };

  const handleCoordBlur = (_field: 'lat' | 'lon', value: string) => {
    const parsed = parseDMS(value.trim());
    if (!parsed) return;
    if (parsed.lat !== undefined) setLat(String(parsed.lat));
    if (parsed.lon !== undefined) setLon(String(parsed.lon));
  };
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const name = resolveLabel(entry.labels, lang) || placeKey;

  useEffect(() => {
    setEditing(false);
  }, [placeKey]);

  // Baasseis: viimati laaditud või edukalt salvestatud väärtused. Dirty = mustand
  // erineb sellest. `editing` ise EI tee vormi dirty'ks — muidu hüppaks salvestamata
  // muudatuste dialoog ette iga kord, kui kasutaja on koha andmeid lihtsalt vaadanud.
  const [baseline, setBaseline] = useState<string>('');

  const currentDraft: PlaceFormDraft = {
    labels, placeType, qCode, parentKey, group, historicalNames, lat, lon, notes,
  };
  const isDirty = editing && normalizeDraft(currentDraft) !== baseline;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (editing) {
      setLabels({ ...(entry.labels ?? {}) });
      setPlaceType(entry.type ?? '');
      setQCode(entry.id ?? '');
      setParentKey(entry.parent_key ?? '');
      setParentQuery(entry.parent_key
        ? (resolveLabel(places[entry.parent_key]?.labels, lang) || entry.parent_key)
        : '');
      setGroup(entry.group ?? '');
      setHistoricalNames([...(entry.historical_names ?? [])]);
      setNewHistName('');
      setLat(entry.coordinates?.lat != null ? String(entry.coordinates.lat) : '');
      setLon(entry.coordinates?.lon != null ? String(entry.coordinates.lon) : '');
      setNotes(entry.notes ?? '');
      setBaseline(normalizeDraft(draftFromEntry(entry)));
      setSaveError(null);
    }
  }, [editing]);

  const filteredParents = Object.entries(places)
    .filter(([k]) => k !== placeKey)
    .filter(([k, e]) => {
      const q = parentQuery.toLowerCase();
      if (!q) return false;
      return (
        k.toLowerCase().includes(q) ||
        Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q))
      );
    })
    .slice(0, 8);

  /**
   * Tagastab `true` ainult siis, kui salvestus õnnestus. Salvestamata muudatuste
   * dialoog sõltub sellest: `false` korral ei tohi kohta vahetada ega lahkuda.
   */
  const handleSave = async (): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);
    try {
      const latNum = lat.trim() ? parseFloat(lat) : undefined;
      const lonNum = lon.trim() ? parseFloat(lon) : undefined;
      const coordinates =
        latNum != null && lonNum != null && !isNaN(latNum) && !isNaN(lonNum)
          ? { lat: latNum, lon: lonNum }
          : null;

      const data: any = {
        labels: Object.fromEntries(Object.entries(labels).filter(([, v]) => v.trim())),
        type: placeType || undefined,
        id: qCode.trim() || null,
        parent_key: parentKey || undefined,
        group: group || undefined,
        historical_names: historicalNames,
        notes: notes || undefined,
      };
      if (coordinates !== undefined) data.coordinates = coordinates;

      const result = await updatePlace(placeKey, data, token);
      onUpdated(result.key, result.entry);
      // Edukas salvestamine teeb praegustest väärtustest uue baasseisu.
      setBaseline(normalizeDraft(currentDraft));
      setEditing(false);
      return true;
    } catch (e: any) {
      setSaveError(e.message ?? t('places.saveError'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Vanem vajab salvestust, et salvestamata muudatuste dialoog saaks seda kutsuda.
  useEffect(() => {
    if (saveRef) saveRef.current = handleSave;
  });

  const coords = entry.coordinates;
  const hasCoords = coords && typeof coords.lat === 'number' && typeof coords.lon === 'number';
  const zoom = ZOOM_BY_TYPE[entry.type ?? ''] ?? 7;

  const wikidataUrl = entry.id ? `https://www.wikidata.org/wiki/${entry.id}` : null;
  const osmUrl = hasCoords
    ? `https://www.openstreetmap.org/?mlat=${coords!.lat}&mlon=${coords!.lon}&zoom=10`
    : null;

  if (editing) {
    return (
      <div className="p-4 overflow-y-auto h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900">{t('places.editTitle', { name })}</h3>
        </div>
        {saveError && <p className="mb-3 text-xs text-red-600">{saveError}</p>}

        {/* Labelid */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">{t('places.labels')}</label>
          <div className="space-y-1">
            {LANGS.map(l => (
              <div key={l} className="flex items-center gap-2">
                <span className="w-5 text-xs text-gray-400 font-mono shrink-0">{l}</span>
                <input
                  type="text"
                  value={labels[l] ?? ''}
                  onChange={e => setLabels(prev => ({ ...prev, [l]: e.target.value }))}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Tüüp + Q-kood */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">{t('places.type')}</label>
            <select
              value={placeType}
              onChange={e => setPlaceType(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
            >
              <option value="">—</option>
              {PLACE_TYPES.map(tp => <option key={tp} value={tp}>{t(`places.types.${tp}`, tp)}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="block text-xs text-gray-500 mb-1">{t('places.qcode')}</label>
            <input
              type="text"
              value={qCode}
              onChange={e => setQCode(e.target.value)}
              placeholder="Q12345"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono"
            />
          </div>
        </div>

        {/* Ülempiirkond */}
        <div className="mb-3 relative">
          <label className="block text-xs text-gray-500 mb-1">{t('places.parentPlace')}</label>
          <input
            type="text"
            value={parentKey ? `${parentQuery} (${parentKey})` : parentQuery}
            onChange={e => { setParentQuery(e.target.value); setParentKey(''); setParentDropOpen(true); }}
            onFocus={() => { if (!parentKey) setParentDropOpen(true); }}
            onBlur={() => setTimeout(() => setParentDropOpen(false), 150)}
            readOnly={!!parentKey}
            placeholder={t('places.parentSearchPlaceholder')}
            className={`w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-primary-500 outline-none
              ${parentKey ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-300'}`}
          />
          {parentKey && (
            <button
              type="button"
              onClick={() => { setParentKey(''); setParentQuery(''); }}
              className="absolute right-2 top-7 text-gray-400 hover:text-gray-600"
            >
              <X size={13} />
            </button>
          )}
          {parentDropOpen && !parentKey && filteredParents.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {filteredParents.map(([k, e]) => (
                <button
                  key={k}
                  type="button"
                  onMouseDown={() => {
                    setParentKey(k);
                    setParentQuery(resolveLabel(e.labels, lang) || k);
                    setParentDropOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-primary-50 border-b border-gray-50 last:border-0 flex items-baseline gap-2"
                >
                  <span className="font-medium">{resolveLabel(e.labels, lang)}</span>
                  <span className="ml-auto text-xs font-mono text-gray-300">{k}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grupp */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">{t('places.group')}</label>
          <select
            value={group}
            onChange={e => setGroup(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
          >
            <option value="">—</option>
            {Object.entries(meta?.groups ?? {})
              .sort(([, a]: any, [, b]: any) => (a.sort_order ?? 50) - (b.sort_order ?? 50))
              .map(([k, v]: any) => (
                <option key={k} value={k}>{resolveLabel(v.labels, lang) || k}</option>
              ))}
          </select>
        </div>

        {/* Ajaloolised nimed */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">{t('places.historicalNames')}</label>
          <div className="flex flex-wrap gap-1 mb-1">
            {historicalNames.map(n => (
              <span key={n} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs flex items-center gap-1">
                {n}
                <button
                  type="button"
                  onClick={() => setHistoricalNames(hn => hn.filter(x => x !== n))}
                  className="text-blue-400 hover:text-blue-600"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              value={newHistName}
              onChange={e => setNewHistName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newHistName.trim()) {
                  e.preventDefault();
                  setHistoricalNames(hn => [...hn, newHistName.trim()]);
                  setNewHistName('');
                }
              }}
              placeholder={t('places.historicalNamePlaceholder')}
              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (newHistName.trim()) {
                  setHistoricalNames(hn => [...hn, newHistName.trim()]);
                  setNewHistName('');
                }
              }}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        {/* Koordinaadid */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">{t('places.coordinates')}</label>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={lat}
              onChange={e => setLat(e.target.value)}
              onBlur={e => handleCoordBlur('lat', e.target.value)}
              placeholder="lat (57.18)"
              className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono"
            />
            <input
              type="text"
              inputMode="decimal"
              value={lon}
              onChange={e => setLon(e.target.value)}
              onBlur={e => handleCoordBlur('lon', e.target.value)}
              placeholder="lon (14.59)"
              className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono"
            />
          </div>
        </div>

        {/* Märkused */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">{t('places.notes')}</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none resize-none"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            {t('places.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {t(saving ? 'places.saving' : 'places.save')}
          </button>
        </div>
      </div>
    );
  }

  // Detailvaade
  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* Päis */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-0.5">{name}</h2>
          {name !== placeKey && (
            <p className="text-xs text-gray-400 mb-1 font-mono">{placeKey}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {entry.type && (
              <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{t(`places.types.${entry.type}`, entry.type)}</span>
            )}
            {wikidataUrl && (
              <a href={wikidataUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 border border-blue-200 bg-blue-50 px-2 py-0.5 rounded-full hover:bg-blue-100">
                🌐 {entry.id}
              </a>
            )}
            {osmUrl && hasCoords && (
              <a href={osmUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-emerald-600 border border-emerald-200 bg-emerald-50 px-2 py-0.5 rounded-full hover:bg-emerald-100">
                📍 {coords!.lat.toFixed(4)}°N, {coords!.lon.toFixed(4)}°E
              </a>
            )}
            <span className="text-xs text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full">
              👥 {personCount}
            </span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 ml-2">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700"
          >
            <Edit2 size={13} />
            {t('places.edit')}
          </button>
          <button
            onClick={() => setShowMerge(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-violet-600 text-white rounded hover:bg-violet-700"
          >
            <GitMerge size={13} />
            {t('places.merge')}
          </button>
          <button
            onClick={() => { setShowDeleteConfirm(true); setDeleteError(null); setDeleteConfirmInput(''); }}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700"
          >
            <Trash2 size={13} />
            {t('places.delete')}
          </button>
        </div>
      </div>

      {/* Kustutamise kinnitus */}
      {showDeleteConfirm && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800 mb-2">
            {t('places.deleteConfirm', { name: resolveLabel(entry.labels, lang) || placeKey })}
          </p>
          <input
            type="text"
            value={deleteConfirmInput}
            onChange={e => setDeleteConfirmInput(e.target.value)}
            placeholder={t('places.deleteInputPlaceholder', { word: t('places.deleteConfirmWord') })}
            className="w-full text-sm border border-red-300 rounded px-2 py-1.5 mb-2 bg-white focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          {deleteError && <p className="text-xs text-red-700 mb-2">{deleteError}</p>}
          <div className="flex gap-2">
            <button
              onClick={async () => {
                setDeleting(true);
                setDeleteError(null);
                try {
                  await deletePlace(placeKey, token);
                  onDeleted(placeKey);
                } catch (e: any) {
                  setDeleteError(e.message ?? t('places.deleteError'));
                  setDeleting(false);
                }
              }}
              disabled={deleting || deleteConfirmInput !== t('places.deleteConfirmWord')}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {deleting ? t('places.deleting') : t('places.delete')}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
            >
              {t('places.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Minikaart */}
      {hasCoords && (
        <div className="mb-3 rounded-lg overflow-hidden border border-gray-200 isolate" style={{ height: 120 }}>
          <MapContainer
            key={placeKey}
            center={[coords!.lat, coords!.lon]}
            zoom={zoom}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
            dragging={true}
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[coords!.lat, coords!.lon]} icon={DEFAULT_MARKER} />
          </MapContainer>
        </div>
      )}

      {/* Andmetabel */}
      <div className="bg-gray-50 rounded-lg border border-gray-100 p-3 mb-3 text-sm space-y-1.5">
        {LANGS.filter(l => entry.labels?.[l]).map(l => (
          <div key={l} className="flex gap-3">
            <span className="w-5 text-xs text-gray-400 font-mono shrink-0 mt-0.5">{l}</span>
            <span className="text-gray-800">{entry.labels![l]}</span>
          </div>
        ))}
        {entry.parent_key && (
          <div className="flex gap-3">
            <span className="text-xs text-gray-400 shrink-0 mt-0.5">{t('places.parentPlace')}</span>
            <button
              type="button"
              onClick={() => onSelectKey(entry.parent_key!)}
              className="text-primary-600 hover:text-primary-800 text-sm"
            >
              {resolveLabel(places[entry.parent_key]?.labels, lang) || entry.parent_key} ↗
            </button>
          </div>
        )}
        {(entry.historical_names ?? []).length > 0 && (
          <div className="flex gap-3 flex-wrap">
            <span className="text-xs text-gray-400 shrink-0 mt-0.5">{t('places.historicalNames')}</span>
            <div className="flex flex-wrap gap-1">
              {(entry.historical_names ?? []).map(n => (
                <span key={n} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">{n}</span>
              ))}
            </div>
          </div>
        )}
        {entry.group && meta?.groups[entry.group] && (
          <div className="flex gap-3">
            <span className="text-xs text-gray-400 shrink-0 mt-0.5">{t('places.group')}</span>
            <span className="text-gray-700">{resolveLabel(meta.groups[entry.group].labels, lang)}</span>
          </div>
        )}
        {entry.notes && (
          <div className="flex gap-3">
            <span className="text-xs text-gray-400 shrink-0 mt-0.5">{t('places.notes')}</span>
            <span className="text-gray-700">{entry.notes}</span>
          </div>
        )}
      </div>

      {/* Isikute loend */}
      <div>
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          {t('places.personsLabel', { count: personCount })}
        </div>
        {personCount === 0 ? (
          <p className="text-sm text-gray-400 italic">{t('places.personsEmpty')}</p>
        ) : (
          <div className="bg-gray-50 rounded-lg border border-gray-100 overflow-hidden">
            {personSample.map(p => (
              <div key={p.id} className="flex items-center justify-between px-3 py-1.5 text-sm border-b border-gray-100 last:border-0">
                <Link to={`/persons/${p.id}`} className="text-primary-600 hover:text-primary-800">{p.name}</Link>
                {p.imm_year && <span className="text-xs text-gray-400">{p.imm_year}</span>}
              </div>
            ))}
            {personCount > personSample.length && (
              <Link
                to={`/persons?origin_place=${encodeURIComponent(placeKey)}`}
                className="block px-3 py-1.5 text-xs text-gray-400 hover:text-primary-600"
              >
                {t('places.personsMore', { count: personCount - personSample.length })}
              </Link>
            )}
          </div>
        )}
      </div>

      {showMerge && (
        <PlacesMergeModal
          sourceKey={placeKey}
          sourceEntry={entry}
          places={places}
          personCount={personCount}
          token={token}
          lang={lang}
          onMerged={(targetKey, _redirected) => {
            setShowMerge(false);
            onMerged(placeKey, targetKey);
          }}
          onClose={() => setShowMerge(false)}
        />
      )}
    </div>
  );
};

export default PlacesDetail;
