import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  searchEnrichmentRegistry, type EnrichmentRegistryCandidate,
  type EnrichmentRegistrySearch,
} from '../../services/prosopographyService';

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
  useEffect(() => { setSearchText(query); setResult(null); }, [query, kind]);

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
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {result && !result.registry_available && <p className="text-amber-800">{tr('registryUnavailable')}</p>}
    {result?.registry_available && result.results.length === 0 && <p>{tr('noRegistryMatches')} {tr('askAdmin')}</p>}
    {result?.ambiguous && <p className="text-amber-800">{tr('multipleMatches')}</p>}
    {result?.truncated && <p className="text-amber-800">{tr('moreMatches')}</p>}
    {result?.results.map(candidate => <button key={candidate.key} type="button"
      disabled={disabled} onClick={() => onSelect(candidate)}
      className={`block w-full rounded border px-2 py-1 text-left disabled:opacity-50 ${chosenKey === candidate.key ? 'border-blue-700 bg-blue-100' : 'bg-white'}`}>
      <strong>{candidate.labels[i18n.language.slice(0, 2)] || candidate.labels.et || candidate.labels.en || candidate.key}</strong>
      {' '}({candidate.key}{candidate.id ? ` · ${candidate.id}` : ''})
      <span className="block text-gray-600">{candidate.match_kind}: {candidate.matched_text}
        {candidate.place_key ? ` · ${tr('institutionPlace')}: ${candidate.place_key}` : ''}</span>
    </button>)}
  </div>;
}
