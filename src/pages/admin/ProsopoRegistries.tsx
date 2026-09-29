import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { isAtLeast } from '../../utils/roleUtils';
import { formatPlacePeriods, parsePlacePeriods, type PlacePeriodError } from './placePeriods';
import PlacePicker from '../../prosopography/components/personForm/PlacePicker';
import RegistryEntryModal from '../../prosopography/components/RegistryEntryModal';
import { formatYears, parseYears } from '../../prosopography/utils/registryCreate';
import type { RegistryEntryLike } from '../../prosopography/utils/registryMatch';
import { fetchPlaces, fetchRegistry, saveRegistryEntry,
  type InstitutionRegistryEntry, type OccupationRegistryEntry } from '../../prosopography/services/prosopographyService';

type Kind = 'occupation' | 'institution';
type Entry = OccupationRegistryEntry | InstitutionRegistryEntry;
const empty = (kind: Kind): Entry => ({ id: null, labels: { et: '', en: '' }, variants: [],
  ...(kind === 'institution' ? { type: '', place_key: null } : {}) });

export default function ProsopoRegistries() {
  const { t, i18n } = useTranslation('admin');
  const tr = (key: string) => t(`prosopoRegistries.${key}`);
  const lang = i18n.language.slice(0, 2);
  const { user, authToken, isLoading: userLoading } = useUser();
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>('institution');
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [query, setQuery] = useState('');
  const [key, setKey] = useState('');
  const [selectedExisting, setSelectedExisting] = useState(false);
  const [draft, setDraft] = useState<Entry>(empty('institution'));
  const [variants, setVariants] = useState('');
  const [periods, setPeriods] = useState('');
  const [yearsText, setYearsText] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [placeKeys, setPlaceKeys] = useState<ReadonlySet<string> | undefined>();

  useEffect(() => {
    if (!userLoading && !isAtLeast(user?.role, 'admin')) navigate('/');
  }, [user, userLoading, navigate]);
  useEffect(() => {
    if (!authToken || !isAtLeast(user?.role, 'admin')) return;
    let live = true;
    setError(''); setKey(''); setSelectedExisting(false); setDraft(empty(kind)); setVariants(''); setPeriods(''); setYearsText('');
    fetchRegistry(kind).then(data => { if (live) setEntries(data); })
      .catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [kind, authToken, user?.role]);
  useEffect(() => {
    if (!isAtLeast(user?.role, 'admin')) return;
    // Laadimata register = kontroll jääb serverile; vorm ei jää selle taha lukku.
    fetchPlaces().then(places => setPlaceKeys(new Set(Object.keys(places)))).catch(() => {});
  }, [user?.role]);

  const shown = useMemo(() => Object.entries(entries).filter(([id, entry]) =>
    [id, ...Object.values(entry.labels), ...entry.variants].some(value =>
      value.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort(([a], [b]) => a.localeCompare(b)),
  [entries, query]);

  const choose = (id: string, from: Record<string, Entry> = entries) => {
    const entry = from[id];
    setKey(id); setSelectedExisting(true); setDraft({ ...entry, labels: { ...entry.labels }, variants: [...entry.variants] });
    setVariants(entry.variants.join('\n'));
    setPeriods(formatPlacePeriods((entry as InstitutionRegistryEntry).place_periods));
    setYearsText(formatYears((entry as InstitutionRegistryEntry).active_from, (entry as InstitutionRegistryEntry).active_to));
    setError(''); setSaved(false);
  };
  const save = async () => {
    if (!authToken || !selectedExisting) return;
    const years = kind === 'institution' ? parseYears(yearsText) : {};
    if (years === null) { setError(tr('yearsInvalid')); return; }
    const parsed = kind === 'institution' ? parsePlacePeriods(periods, placeKeys) : { periods: [] };
    if ('errorLine' in parsed) { setError(periodError(parsed)); return; }
    setBusy(true); setError(''); setSaved(false);
    try {
      const { active_from: _from, active_to: _to, ...rest } = draft as InstitutionRegistryEntry;
      const value = { ...rest, ...years,
        labels: Object.fromEntries(Object.entries(draft.labels).filter(([, label]) => label.trim())),
        variants: variants.split('\n').map(v => v.trim()).filter(Boolean),
        ...(kind === 'institution' ? { place_periods: parsed.periods } : {}) };
      const stored = await saveRegistryEntry(kind, key, value, authToken);
      setEntries(current => ({ ...current, [key]: stored }));
      setDraft(stored);
      setVariants(stored.variants.join('\n'));
      setPeriods(formatPlacePeriods((stored as InstitutionRegistryEntry).place_periods));
      setYearsText(formatYears((stored as InstitutionRegistryEntry).active_from, (stored as InstitutionRegistryEntry).active_to));
      setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const institution = kind === 'institution' ? draft as InstitutionRegistryEntry : null;
  const periodError = (e: PlacePeriodError) =>
    t(`prosopoRegistries.placePeriodsError.${e.reason}`, { line: e.errorLine, value: e.value });

  if (!isAtLeast(user?.role, 'admin')) return null;

  return <div className="min-h-screen bg-gray-50">
    <Header showSearchButton={false} pageTitle={tr('title')} />
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-2 text-xl font-semibold">{tr('title')}</h1>
      <p className="mb-4 text-sm text-gray-600">{tr('intro')}</p>
      <div className="mb-4 flex gap-2">
        {(['institution', 'occupation'] as const).map(value => <button key={value} type="button"
          onClick={() => setKind(value)} aria-pressed={kind === value}
          className={`rounded border px-3 py-1.5 ${kind === value ? 'bg-primary-700 text-white' : 'bg-white'}`}>
          {tr(value)}
        </button>)}
      </div>
      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <section className="rounded border bg-white p-3">
          <input aria-label={tr('search')} value={query} onChange={e => setQuery(e.target.value)}
            placeholder={tr('search')} className="mb-2 w-full rounded border px-2 py-1.5" />
          <button type="button" onClick={() => setCreating(true)} className="mb-2 w-full rounded border px-2 py-1.5 text-left text-primary-700">
            {tr('new')}
          </button>
          <div className="max-h-[65vh] overflow-y-auto">
            {shown.map(([id, entry]) => <button key={id} type="button" onClick={() => choose(id)}
              className={`block w-full rounded px-2 py-1.5 text-left text-sm ${id === key ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
              {entry.labels[lang] || entry.labels.et || entry.labels.en || id}
              <span className="block text-xs text-gray-500">
                {[id, formatYears((entry as InstitutionRegistryEntry).active_from, (entry as InstitutionRegistryEntry).active_to)]
                  .filter(Boolean).join(' · ')}
              </span>
            </button>)}
          </div>
        </section>
        {!selectedExisting ? <section className="rounded border bg-white p-4 text-sm text-gray-500">{tr('chooseOrCreate')}</section>
        : <section className="space-y-3 rounded border bg-white p-4">
          <p className="text-sm">{tr('key')} <code className="font-mono">{key}</code></p>
          <label className="block text-sm">{tr('qid')}
            <input value={draft.id ?? ''} onChange={e => setDraft(d => ({ ...d, id: e.target.value || null }))}
              className="mt-1 block w-full rounded border px-2 py-1.5" />
          </label>
          {(['et', 'en'] as const).map(code => <label key={code} className="block text-sm">{tr('label')} {code.toUpperCase()}
            <input value={draft.labels[code] ?? ''} onChange={e => setDraft(d => ({ ...d,
              labels: { ...d.labels, [code]: e.target.value } }))}
              className="mt-1 block w-full rounded border px-2 py-1.5" />
          </label>)}
          <label className="block text-sm">{tr('variants')}
            <textarea value={variants} onChange={e => setVariants(e.target.value)} rows={4}
              className="mt-1 block w-full rounded border px-2 py-1.5" />
          </label>
          {institution && <>
            <label className="block text-sm">{tr('type')}
              <input value={institution.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}
                className="mt-1 block w-full rounded border px-2 py-1.5" />
            </label>
            <div className="text-sm">
              {/* Valik kohtade registrist: vabatekstina läks „Tartu" serverisse ja tuli tagasi unknown_place_key. */}
              <PlacePicker value={institution.place_key} token={authToken ?? ''} canEdit lang={lang}
                label={tr('placeKey')} onChange={place_key => setDraft(d => ({ ...d, place_key }))} />
              {institution.place_key && <span className="mt-1 block text-xs text-gray-500">
                {tr('placeKeyValue')} <code className="font-mono">{institution.place_key}</code>
              </span>}
            </div>
            <label className="block text-sm">{tr('years')}
              <input value={yearsText} onChange={e => setYearsText(e.target.value)} placeholder="1630–1632"
                className="mt-1 block w-full rounded border px-2 py-1.5" />
              <span className="mt-1 block text-xs text-gray-500">{tr('yearsHelp')}</span>
            </label>
            <label className="block text-sm">{tr('placePeriods')}
              <span className="mt-1 block text-xs text-gray-600">{tr('placePeriodsHelp')}</span>
              <textarea value={periods} onChange={e => setPeriods(e.target.value)} rows={3}
                placeholder="Dorpat: –1699&#10;Pernau: 1699–1710" className="mt-1 block w-full rounded border px-2 py-1.5 font-mono text-xs" />
            </label>
          </>}
          <label className="block text-sm">{tr('notes')}
            <textarea value={draft.notes ?? ''} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              rows={2} className="mt-1 block w-full rounded border px-2 py-1.5" />
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {saved && <p role="status" className="text-sm text-green-700">{tr('saved')}</p>}
          <button type="button" disabled={busy || !key.trim() || !draft.labels.et?.trim()}
            onClick={() => void save()} className="rounded bg-primary-700 px-4 py-2 text-white disabled:opacity-50">
            {tr('save')}
          </button>
        </section>}
      </div>
      {creating && authToken && <RegistryEntryModal kind={kind} initialQuery={query} lang={lang} token={authToken}
        registry={entries as Record<string, RegistryEntryLike>}
        onClose={() => setCreating(false)}
        onUseExisting={id => { setCreating(false); choose(id); }}
        onCreated={(id, entry) => {
          const next = { ...entries, [id]: entry as Entry };
          setCreating(false); setEntries(next); choose(id, next); setSaved(true);
        }} />}
    </main>
  </div>;
}
