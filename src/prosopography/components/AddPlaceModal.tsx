import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, Loader2, Plus } from 'lucide-react';
import WikidataPlaceSearch from './WikidataPlaceSearch';
import type { PlaceSuggestion, WikidataPlace } from '../services/prosopographyService';
import { addPlace } from '../services/prosopographyService';
import type { PlaceEntry } from '../types';


export interface AddPlaceModalProps {
  query: string;
  initialSelection?: { item: PlaceSuggestion; details: WikidataPlace };
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

const AddPlaceModal: React.FC<AddPlaceModalProps> = ({ query, initialSelection, meta, places: initialPlaces, onAdd, onClose, token }) => {
  const { t, i18n } = useTranslation('prosopography');
  const lang = i18n.language?.slice(0, 2) ?? 'et';

  // Lokaalne places — kasvab kui lisatakse ülempiirkond
  const [places, setPlaces] = useState(initialPlaces);

  // Wikidata otsing (põhikoht)
  const [wdSelected, setWdSelected] = useState<{ q: string; label: string } | null>(initialSelection?.item ?? null);
  const [wdParents, setWdParents] = useState<{ q: string; label_en: string; label_sv: string }[]>(initialSelection?.details.parents ?? []);
  const [wdCoordinates, setWdCoordinates] = useState<PlaceEntry['coordinates'] | null>(initialSelection?.details.coordinates ?? null);

  // Parent — registriotsing
  const [parentQuery, setParentQuery] = useState('');
  const [parentDropOpen, setParentDropOpen] = useState(false);
  const [parentKey, setParentKey] = useState('');

  // Parent — Wikidata otsing + lisamine
  const [parentWdOpen, setParentWdOpen] = useState(false);
  const [parentWdQuery, setParentWdQuery] = useState('');
  const [parentWdPreview, setParentWdPreview] = useState<WdPreview | null>(null);
  const [parentWdAdding, setParentWdAdding] = useState(false);
  const [parentWdError, setParentWdError] = useState<string | null>(null);

  // Vorm
  const [labels, setLabels] = useState<Record<string, string>>(initialSelection?.details.labels ?? {});
  const [name, setName] = useState(initialSelection ? (initialSelection.details.labels.et || initialSelection.details.labels.en || initialSelection.item.label) : query);
  const [placeType, setPlaceType] = useState(initialSelection?.details.type ?? '');
  const [qCode, setQCode] = useState(initialSelection?.item.q ?? '');
  const [group, setGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const resolveLabel = (lbls: Record<string, string> | undefined | null) => {
    if (!lbls) return '';
    return lbls[lang] ?? lbls.et ?? lbls.en ?? Object.values(lbls)[0] ?? '';
  };

  // ── Põhikoha Wikidata otsing ─────────────────────────────────────────────

  const applySelection = (item: PlaceSuggestion, wd: WikidataPlace) => {
    // A Q-code is an identity, not a reason to create a second register entry.
    const existing = Object.entries(places).find(([, e]) => e.id === item.q);
    if (existing) { onAdd(existing[0], existing[1]); return; }
    setWdSelected(item);
    setQCode(item.q);
    setLabels(wd.labels);
    setName(wd.labels.et || wd.labels.en || wd.labels.sv || item.label);
    setPlaceType(wd.type ?? '');
    setWdCoordinates(wd.coordinates);
    setWdParents(wd.parents);
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

  const handleP131Click = (p: { q: string; label_en: string; label_sv: string }) => {
    const existing = Object.entries(places).find(([, e]) => e.id === p.q);
    if (existing) { selectParent(existing[0]); return; }
    setParentWdQuery(p.q);
    setParentWdPreview(null);
    setParentWdOpen(true);
  };

  const selectParentWikidata = (item: PlaceSuggestion, wd: WikidataPlace) => {
    const existing = Object.entries(places).find(([, e]) => e.id === item.q);
    if (existing) { selectParent(existing[0]); return; }
    const lbls = Object.keys(wd.labels).length ? wd.labels : { en: item.label };
    const proposedKey = (lbls.et || lbls.en || item.label).replace(/\s+/g, '_');
    setParentWdPreview({ q: item.q, proposedKey, labels: lbls, type: wd.type ?? '', coordinates: wd.coordinates });
    setParentWdError(null);
  };

  const handleAddParentFromWd = async () => {
    if (!parentWdPreview) return;
    if (places[parentWdPreview.proposedKey]) { setParentWdError(t('place.keyExists')); return; }
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
      setParentWdError(e.message ?? t('placeModal.addError'));
    } finally {
      setParentWdAdding(false);
    }
  };

  // ── Salvestamine ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!name.trim()) { setError(t('form.nameRequired')); return; }
    const key = name.trim().replace(/\s+/g, '_');
    if (places[key]) { setError(t('place.keyExists')); return; }
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
          <label className="block text-xs text-gray-500 mb-1">{t('placeModal.searchWikidata')}</label>
          <WikidataPlaceSearch initialQuery={initialSelection ? '' : query} lang={lang} onSelect={applySelection} />
          {wdSelected && <p className="mt-2 text-sm text-green-800">{wdSelected.label} · {wdSelected.q}</p>}
          {wdSelected && !wdCoordinates && <p className="mt-1 text-xs text-amber-700">{t('place.noCoordinates')}</p>}
          {wdSelected && wdCoordinates && (
            <p className="mt-1 text-xs text-green-700">
              {t('placeModal.coordinates')} {wdCoordinates.lat.toFixed(5)}, {wdCoordinates.lon.toFixed(5)}
            </p>
          )}
          {wdSelected && wdParents.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">{t('placeModal.parentFromWikidata')}</p>
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
            <label className="block text-xs text-gray-500 mb-1">{t('placeModal.nameInRegistry')}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">{t('placeModal.type')}</label>
              <select value={placeType} onChange={e => setPlaceType(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none">
                <option value="">—</option>
                {(meta?.allowed_types ?? []).map(tp => <option key={tp} value={tp}>{tp}</option>)}
              </select>
            </div>
            <div className="w-32">
              <label className="block text-xs text-gray-500 mb-1">{t('placeModal.qCode')}</label>
              <input type="text" value={qCode} readOnly
                placeholder="Q12345"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono" />
            </div>
          </div>
          {!qCode.trim() && <p className="text-xs text-amber-600">{t('noQCode')}</p>}

          {/* Ülempiirkond */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('placeModal.parentRegion')}</label>

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
                placeholder={t('placeModal.searchRegistry')}
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
                onClick={() => { setParentWdOpen(v => !v); setParentWdQuery(parentQuery); setParentWdPreview(null); setParentWdError(null); }}
                className="mt-1.5 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Search size={11} />
                {parentWdOpen ? t('placeModal.hideWikidata') : t('placeModal.searchWikidata')}
              </button>
            )}

            {/* Ülempiirkonna Wikidata otsing */}
            {parentWdOpen && !parentKey && (
              <div className="mt-2 bg-blue-50 border border-blue-200 rounded p-2.5 space-y-2">
                <WikidataPlaceSearch key={parentWdQuery} initialQuery={parentWdQuery} lang={lang} onSelect={selectParentWikidata} />
                {parentWdPreview && (
                  <div className="bg-white border border-blue-300 rounded p-2 space-y-1">
                    <div className="text-xs text-gray-600 space-y-0.5">
                      {Object.entries(parentWdPreview.labels).map(([l, lbl]) => (
                        <div key={l}><span className="font-mono text-gray-400 w-5 inline-block">{l}</span> {lbl}</div>
                      ))}
                      <div className="text-gray-400 mt-0.5">
                        {t('placeModal.keyLabel')} <span className="font-mono">{parentWdPreview.proposedKey}</span>
                        {parentWdPreview.type && <span className="ml-2">{t('placeModal.typeLabel')} {parentWdPreview.type}</span>}
                      </div>
                    </div>
                    {parentWdError && <p className="text-xs text-red-600">{parentWdError}</p>}
                    <button type="button" onClick={handleAddParentFromWd} disabled={parentWdAdding}
                      className="w-full px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                      {parentWdAdding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                      {t('placeModal.addParent')}
                    </button>
                  </div>
                )}
                {parentWdError && !parentWdPreview && <p className="text-xs text-red-600">{parentWdError}</p>}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('placeModal.group')}</label>
            <select value={group} onChange={e => setGroup(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none">
              <option value="">—</option>
              {/* Alamgrupid (Götaland jt) oma ülemgrupi järel — ADR 0052: Rootsi koht
                  kuulub ajaloolise maakonna järgi alamgruppi, `rootsi` on ainult varu */}
              {Object.entries(meta?.groups ?? {})
                .filter(([, v]: any) => !v.parent)
                .sort((a: any, b: any) => (a[1].sort_order ?? 50) - (b[1].sort_order ?? 50))
                .flatMap(([k, v]: any) => [
                  <option key={k} value={k}>{v.labels?.et ?? k}</option>,
                  ...Object.entries(meta?.groups ?? {})
                    .filter(([, c]: any) => c.parent === k)
                    .sort((a: any, b: any) => (a[1].sort_order ?? 50) - (b[1].sort_order ?? 50))
                    .map(([ck, c]: any) => (
                      <option key={ck} value={ck}>{'   '}{c.labels?.et ?? ck}</option>
                    )),
                ])}
            </select>
            <p className="mt-1 text-xs text-gray-500">{t('placeModal.groupHint')}</p>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">{t('placeModal.cancel')}</button>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-60">
            {saving ? '…' : t('placeModal.add')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddPlaceModal;
