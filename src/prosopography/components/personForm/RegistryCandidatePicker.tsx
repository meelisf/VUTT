import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchRegistry, searchEnrichmentRegistry, type EnrichmentRegistryCandidate,
  type EnrichmentRegistrySearch, type InstitutionRegistryEntry, type OccupationRegistryEntry,
} from '../../services/prosopographyService';
import { useUser } from '../../../contexts/UserContext';
import { isAtLeast } from '../../../utils/roleUtils';
import RegistryEntryForm from './RegistryEntryForm';

type Entry = OccupationRegistryEntry | InstitutionRegistryEntry;

interface Props {
  kind: 'occupation' | 'institution';
  query: string;
  disabled: boolean;
  chosenKey?: string;
  onSelect: (candidate: EnrichmentRegistryCandidate) => void;
}

export default function RegistryCandidatePicker({ kind, query, disabled, chosenKey, onSelect }: Props) {
  const { t, i18n } = useTranslation('prosopography');
  const tr = (key: string) => t(`agentEnrichment.${key}`);
  const [result, setResult] = useState<EnrichmentRegistrySearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searchText, setSearchText] = useState(query);
  // Registrikirje kirjutab ainult admin (ADR 0059); vorm on siin, et „notar” ei
  // nõuaks registrilehel käimist ja rea uuesti valimist.
  const { user, authToken } = useUser();
  const canEditRegistry = isAtLeast(user?.role, 'admin') && Boolean(authToken);
  const [form, setForm] = useState<null | { key: string; entry: Entry } | 'new'>(null);
  useEffect(() => { setSearchText(query); setResult(null); setForm(null); }, [query, kind]);

  const registryEntry = async (key: string) => (await fetchRegistry(kind))[key];
  const editEntry = async (key: string) => {
    setError('');
    try {
      const entry = await registryEntry(key);
      if (entry) setForm({ key, entry });
    } catch (err) { setError((err as Error).message); }
  };
  const saved = (key: string, entry: Entry) => {
    setForm(null);
    const wording = query.trim();
    onSelect({
      key, id: entry.id, labels: entry.labels, match_kind: 'editor', matched_text: key,
      // Nimevariant seotakse ainult siis, kui allika sõnastus on registris variandina.
      matched_variant: entry.variants.includes(wording) ? wording : null,
      ...('type' in entry ? { type: entry.type, place_key: entry.place_key } : {}),
    });
    if (result) void search();
  };

  const search = async () => {
    setBusy(true); setError('');
    try { setResult(await searchEnrichmentRegistry(kind, searchText)); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="rounded border border-blue-100 bg-blue-50/40 p-2 space-y-2 text-xs">
    <div className="flex gap-2">
      <input aria-label={kind === 'occupation' ? tr('occupationSearch') : tr('institutionSearch')}
        value={searchText} onChange={event => setSearchText(event.target.value)}
        className="min-w-0 flex-1 rounded border px-2 py-1" />
      <button type="button" disabled={disabled || busy || !searchText.trim()}
        onClick={() => void search()} className="rounded border px-2 py-1 disabled:opacity-50">
        {kind === 'occupation' ? tr('occupationSearch') : tr('institutionSearch')}
      </button>
      {canEditRegistry && <button type="button" disabled={disabled || form !== null}
        onClick={() => setForm('new')} className="rounded border border-green-700 px-2 py-1 text-green-800 disabled:opacity-50">
        {tr('registryForm.new')}
      </button>}
    </div>
    {form && authToken && <RegistryEntryForm kind={kind} sourceWording={query}
      existing={form === 'new' ? undefined : form} token={authToken}
      takenKeys={async key => Boolean(await registryEntry(key))}
      onSaved={saved} onCancel={() => setForm(null)} />}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {result && !result.registry_available && <p className="text-amber-800">{tr('registryUnavailable')}</p>}
    {result?.registry_available && result.results.length === 0 && <p>{tr('noRegistryMatches')} {tr('askAdmin')}</p>}
    {result?.ambiguous && <p className="text-amber-800">{tr('multipleMatches')}</p>}
    {result?.truncated && <p className="text-amber-800">{tr('moreMatches')}</p>}
    {result?.results.map(candidate => <div key={candidate.key} className="flex gap-1">
      <button type="button" disabled={disabled} onClick={() => onSelect(candidate)}
        className={`block min-w-0 flex-1 rounded border px-2 py-1 text-left disabled:opacity-50 ${chosenKey === candidate.key ? 'border-blue-700 bg-blue-100' : 'bg-white'}`}>
        <strong>{candidate.labels[i18n.language.slice(0, 2)] || candidate.labels.et || candidate.labels.en || candidate.key}</strong>
        {' '}({candidate.key}{candidate.id ? ` · ${candidate.id}` : ''})
        <span className="block text-gray-600">{candidate.match_kind}: {candidate.matched_text}
          {candidate.place_key ? ` · ${tr('institutionPlace')}: ${candidate.place_key}` : ''}</span>
      </button>
      {canEditRegistry && <button type="button" disabled={disabled || form !== null}
        onClick={() => void editEntry(candidate.key)}
        className="shrink-0 rounded border px-2 py-1 disabled:opacity-50">{tr('registryForm.edit')}</button>}
    </div>)}
  </div>;
}
