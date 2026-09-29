// src/prosopography/components/RegistryEntryModal.tsx
/**
 * Uus ameti- või asutusekirje (ADR 0059) samas käigus nagu koha lisamine:
 * Wikidata otsing → kandidaadi andmed → kontroll registri vastu → salvestus.
 * Võtme genereerib server; siin näeb ainult eelvaadet. Sama Q-kood registris
 * → uut ei looda, pakutakse olemasolevat. Sarnane nimi → inimene kinnitab,
 * et tegu on teise kirjega (Tartu gümnaasium 1630 ≠ kubermangugümnaasium 1804).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Loader2, Search, X } from 'lucide-react';
import { getEntityDescriptions, getWikidataEntity, searchWikidata, type WikidataSearchResult } from '../../services/wikidataService';
import { createRegistryEntry, fetchPlaces, RegistryDuplicateError,
  type InstitutionRegistryEntry, type OccupationRegistryEntry } from '../services/prosopographyService';
import { entityToRegistryDraft, formatYears, parseYears, previewKey, sameIdEntry, similarEntries,
  type RegistryDraft, type RegistryKind } from '../utils/registryCreate';
import { registryLabel, type RegistryEntryLike } from '../utils/registryMatch';
import PlacePicker from './personForm/PlacePicker';

const DEFAULT_TYPES = ['university', 'gymnasium', 'school', 'parish'];

interface Props {
  kind: RegistryKind;
  initialQuery: string;
  registry: Record<string, RegistryEntryLike>;
  token: string;
  lang: string;
  onCreated: (key: string, entry: RegistryEntryLike) => void;
  onUseExisting: (key: string) => void;
  onClose: () => void;
}

const RegistryEntryModal: React.FC<Props> = ({ kind, initialQuery, registry, token, lang,
  onCreated, onUseExisting, onClose }) => {
  const { t } = useTranslation('prosopography');
  const tr = (key: string, opts?: Record<string, unknown>) => t(`registryModal.${key}`, opts);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<WikidataSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingEntity, setLoadingEntity] = useState(false);
  const [places, setPlaces] = useState<Record<string, { id?: string | null }>>({});
  const [draft, setDraft] = useState<RegistryDraft | null>(null);
  const [variantsText, setVariantsText] = useState('');
  const [yearsText, setYearsText] = useState('');
  const [confirmedDifferent, setConfirmedDifferent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const searchSeq = useRef(0);

  useEffect(() => { if (kind === 'institution') fetchPlaces().then(setPlaces).catch(() => {}); }, [kind]);

  const search = async (text: string) => {
    const q = text.trim();
    if (q.length < 2) { setResults([]); return; }
    const seq = ++searchSeq.current;
    setSearching(true); setError('');
    try {
      // Eesti- ja ingliskeelne otsing koos: ajaloolistel asutustel on sageli ainult üks neist.
      const lists = await Promise.all([...new Set([lang, 'en'])].map(l => searchWikidata(q, l, { throwOnError: true })));
      if (seq !== searchSeq.current) return;
      const seen = new Set<string>();
      setResults(lists.flat().filter(r => !seen.has(r.id) && seen.add(r.id)));
    } catch {
      if (seq === searchSeq.current) { setResults([]); setError(tr('wikidataError')); }
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };
  useEffect(() => { void search(initialQuery); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startDraft = (next: RegistryDraft) => {
    setDraft(next);
    setVariantsText(next.variants.join('\n'));
    setYearsText(formatYears(next.active_from, next.active_to));
    setConfirmedDifferent(false); setError('');
  };
  const pick = async (result: WikidataSearchResult) => {
    setLoadingEntity(true); setError('');
    try {
      const entity = await getWikidataEntity(result.id);
      const next = entityToRegistryDraft(entity, kind, places);
      // Allika sõnastus („Tartu gümnaasium") on isiku kaardil; registrisse nimevariandiks, kui seda seal pole.
      if (initialQuery.trim() && ![...Object.values(next.labels), ...next.variants]
        .some(v => v.toLocaleLowerCase() === initialQuery.trim().toLocaleLowerCase())) {
        next.variants = [initialQuery.trim(), ...next.variants];
      }
      startDraft(next);
    } catch {
      setError(tr('wikidataError'));
    } finally {
      setLoadingEntity(false);
    }
  };
  const manual = () => startDraft({ id: null, labels: { et: query.trim() || initialQuery.trim() },
    variants: initialQuery.trim() && initialQuery.trim() !== query.trim() ? [initialQuery.trim()] : [],
    ...(kind === 'institution' ? { type: '', place_key: null } : {}) });

  const years = parseYears(yearsText);
  const current: RegistryDraft | null = draft && {
    ...draft, variants: variantsText.split('\n').map(v => v.trim()).filter(Boolean),
    active_from: years?.active_from, active_to: years?.active_to,
  };
  const existingKey = current ? sameIdEntry(registry, current.id) : null;
  const similar = current ? similarEntries(registry, current, lang) : [];
  // Sarnase kirje Wikidata kirjeldus („endine gümnaasium Tartus 1804-1890") aitab ka siis,
  // kui registrikirjel tegutsemisaega pole. Registrisse seda ei salvestata.
  const similarIds = similar.map(s => s.entry.id).filter((id): id is string => !!id).join('|');
  useEffect(() => {
    if (!similarIds) return;
    let live = true;
    getEntityDescriptions(similarIds.split('|'), lang).then(found => { if (live) setDescriptions(d => ({ ...d, ...found })); });
    return () => { live = false; };
  }, [similarIds, lang]);
  const types = useMemo(() => [...new Set([...DEFAULT_TYPES,
    ...Object.values(registry).map(e => (e as { type?: string }).type).filter((v): v is string => !!v)])].sort(), [registry]);

  const missing = !current?.labels.et?.trim() ? 'label'
    : kind === 'institution' && !current?.type?.trim() ? 'type'
    : years === null ? 'years' : null;
  const canSave = !!current && !saving && !existingKey && !missing && (similar.length === 0 || confirmedDifferent);

  const save = async () => {
    if (!current || !canSave) return;
    setSaving(true); setError('');
    const labels = Object.fromEntries(Object.entries(current.labels).filter(([, v]) => v.trim()));
    const body = {
      id: current.id, labels, variants: current.variants, ...(current.notes ? { notes: current.notes } : {}),
      ...(kind === 'institution' ? { type: current.type ?? '', place_key: current.place_key ?? null,
        ...(current.active_from !== undefined ? { active_from: current.active_from } : {}),
        ...(current.active_to !== undefined ? { active_to: current.active_to } : {}) } : {}),
    } as OccupationRegistryEntry | InstitutionRegistryEntry;
    try {
      const created = await createRegistryEntry(kind, body, token);
      onCreated(created.key, created.entry as RegistryEntryLike);
    } catch (e) {
      if (e instanceof RegistryDuplicateError) setError(tr('duplicateId', { key: e.key }));
      else setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const describe = (entry: RegistryEntryLike) => [entry.id, formatYears(entry.active_from, entry.active_to),
    entry.place_key].filter(Boolean).join(' · ');
  const input = 'w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none';

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={tr(`title.${kind}`)}
        className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">{tr(`title.${kind}`)}</h3>
          <button type="button" onClick={onClose} aria-label={tr('close')} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {error && <p role="alert" className="mb-3 text-xs text-red-600">{error}</p>}

        {!draft ? (
          <div>
            <label className="mb-1 block text-xs text-gray-500" htmlFor="registry-wd-search">{tr('searchWikidata')}</label>
            <div className="flex gap-2">
              <input id="registry-wd-search" type="text" value={query} autoFocus className={input}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search(query); } }} />
              <button type="button" onClick={() => void search(query)} disabled={searching || query.trim().length < 2}
                aria-label={tr('search')}
                className="flex items-center rounded bg-primary-600 px-2.5 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50">
                {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              </button>
            </div>
            {loadingEntity && <p className="mt-2 flex items-center gap-1 text-xs text-gray-400"><Loader2 size={11} className="animate-spin" /> {tr('loading')}</p>}
            {results && results.length > 0 && (
              <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-gray-200">
                {results.map(r => {
                  const known = sameIdEntry(registry, r.id);
                  return (
                    <button key={r.id} type="button" disabled={loadingEntity}
                      onClick={() => known ? onUseExisting(known) : void pick(r)}
                      className="block w-full border-b border-gray-50 px-3 py-2 text-left last:border-0 hover:bg-primary-50">
                      <span className="text-sm font-medium text-gray-900">{r.label}</span>
                      <span className="ml-2 font-mono text-xs text-gray-400">{r.id}</span>
                      {r.description && <span className="block text-xs text-gray-500">{r.description}</span>}
                      {known && <span className="mt-0.5 block text-xs text-teal-700">
                        {tr('alreadyInRegistry', { label: registryLabel(registry[known], known, lang), key: known })}
                      </span>}
                    </button>
                  );
                })}
              </div>
            )}
            {results && results.length === 0 && !searching && <p className="mt-2 text-xs text-gray-500">{tr('noResults')}</p>}
            <button type="button" onClick={manual} className="mt-3 text-xs text-primary-700 hover:underline">{tr('manual')}</button>
          </div>
        ) : current && (
          <div className="space-y-3">
            <button type="button" onClick={() => setDraft(null)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
              <ArrowLeft size={12} /> {tr('back')}
            </button>
            {current.id
              ? <p className="text-xs text-gray-600"><span className="font-mono">{current.id}</span>{current.description ? ` — ${current.description}` : ''}</p>
              : <p className="text-xs text-amber-700">{tr('noWikidata')}</p>}

            {existingKey && (
              <div className="rounded border border-teal-200 bg-teal-50 p-2 text-xs text-teal-900">
                <p>{tr('sameId', { label: registryLabel(registry[existingKey], existingKey, lang), key: existingKey })}</p>
                <button type="button" onClick={() => onUseExisting(existingKey)}
                  className="mt-1 rounded bg-teal-700 px-2 py-1 text-white hover:bg-teal-800">{tr('useExisting')}</button>
              </div>
            )}

            {(['et', 'en'] as const).map(code => (
              <label key={code} className="block text-xs text-gray-500">{tr('label')} {code.toUpperCase()}
                <input value={current.labels[code] ?? ''} className={`mt-1 ${input}`}
                  onChange={e => setDraft(d => d && ({ ...d, labels: { ...d.labels, [code]: e.target.value } }))} />
              </label>
            ))}
            <label className="block text-xs text-gray-500">{tr('variants')}
              <textarea value={variantsText} rows={3} onChange={e => setVariantsText(e.target.value)} className={`mt-1 ${input}`} />
            </label>

            {kind === 'institution' && <>
              <label className="block text-xs text-gray-500">{tr('type')}
                <input list="registry-types" value={current.type ?? ''} className={`mt-1 ${input}`}
                  onChange={e => setDraft(d => d && ({ ...d, type: e.target.value }))} />
                <datalist id="registry-types">{types.map(type => <option key={type} value={type} />)}</datalist>
              </label>
              <PlacePicker value={current.place_key ?? null} token={token} canEdit lang={lang} label={tr('place')}
                onChange={place_key => setDraft(d => d && ({ ...d, place_key }))} />
              <label className="block text-xs text-gray-500">{tr('years')}
                <input value={yearsText} placeholder="1630–1632" onChange={e => setYearsText(e.target.value)}
                  className={`mt-1 ${input} ${years === null ? 'border-red-400' : ''}`} />
                <span className="mt-0.5 block text-gray-400">{tr('yearsHelp')}</span>
              </label>
            </>}

            <label className="block text-xs text-gray-500">{tr('notes')}
              <textarea value={current.notes ?? ''} rows={2} className={`mt-1 ${input}`}
                onChange={e => setDraft(d => d && ({ ...d, notes: e.target.value }))} />
            </label>

            {!existingKey && similar.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                <p className="font-medium">{tr('similarTitle')}</p>
                <ul className="my-1 space-y-1">
                  {similar.map(s => (
                    <li key={s.key} className="flex items-baseline justify-between gap-2">
                      <span>{s.label} <span className="font-mono text-amber-700">{s.key}</span>
                        {describe(s.entry) && <span className="block text-amber-700">{describe(s.entry)}</span>}
                        {s.entry.id && descriptions[s.entry.id] && <span className="block italic text-amber-700">{descriptions[s.entry.id]}</span>}</span>
                      <button type="button" onClick={() => onUseExisting(s.key)}
                        className="shrink-0 rounded border border-amber-300 px-1.5 py-0.5 hover:bg-amber-100">{tr('useThis')}</button>
                    </li>
                  ))}
                </ul>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={confirmedDifferent} onChange={e => setConfirmedDifferent(e.target.checked)} />
                  {tr('confirmDifferent')}
                </label>
              </div>
            )}

            {!existingKey && <p className="text-xs text-gray-500">
              {tr('keyPreview')} <code className="font-mono">{previewKey(registry, current)}</code>
            </p>}
            {missing && !existingKey && <p className="text-xs text-gray-500">{tr(`missing.${missing}`)}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">{tr('cancel')}</button>
              <button type="button" onClick={() => void save()} disabled={!canSave}
                className="rounded bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {saving ? '…' : tr('save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RegistryEntryModal;
