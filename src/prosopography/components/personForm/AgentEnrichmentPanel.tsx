import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ProsopoRecord } from '../../types';
import {
  applyEnrichmentProposal, createEnrichmentHandoff, listEnrichmentProposals,
  type EnrichmentItem, type EnrichmentProposal,
} from '../../services/prosopographyService';

interface Props {
  person: ProsopoRecord;
  token: string;
  isDirty: boolean;
  onApplied: (person: ProsopoRecord) => void;
}

const dateText = (value?: { date: string; precision?: string; bound?: string; calendar?: string; is_circa?: boolean }) =>
  value ? [value.date, value.precision, value.bound, value.calendar, value.is_circa ? 'circa' : ''].filter(Boolean).join(' · ') : '…';

export default function AgentEnrichmentPanel({ person, token, isDirty, onApplied }: Props) {
  const { t } = useTranslation('prosopography');
  const tr = (key: string) => t(`agentEnrichment.${key}`);
  const [proposals, setProposals] = useState<EnrichmentProposal[]>([]);
  const [code, setCode] = useState('');
  const [codeExpiry, setCodeExpiry] = useState(0);
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try { setProposals(await listEnrichmentProposals(person.id, token)); }
    catch (err) { setError((err as Error).message); }
  }, [person.id, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createCode = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await createEnrichmentHandoff(person.id, token);
      setCode(result.code); setCodeExpiry(result.expires_at);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const apply = async (proposal: EnrichmentProposal) => {
    const indices = selected[proposal.proposal_id] ?? [];
    if (isDirty || !indices.length || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const updated = await applyEnrichmentProposal(person.id, proposal.proposal_id, indices, token);
      onApplied(updated);
      setCode(''); setSelected({});
      await refresh();
      setMessage(tr('saved'));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const canSelect = (item: EnrichmentItem) => !item.review_error && (
    item.match_status === 'matched' || (item.match_status === 'already_present'
      && item.existing_index !== undefined && Boolean(item.kind === 'occupation' ? item.occupation_key : item.institution_key))
  );

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3" aria-label={tr('title')}>
      <h3 className="font-semibold text-sm">{tr('title')}</h3>
      <p className="text-xs text-gray-600">{tr('intro')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={createCode} disabled={busy || isDirty}
          className="px-3 py-1.5 rounded bg-blue-700 text-white text-sm disabled:opacity-50">{tr('createCode')}</button>
        <button type="button" onClick={() => void refresh()} disabled={busy}
          className="px-3 py-1.5 rounded border border-blue-300 text-sm disabled:opacity-50">{tr('refresh')}</button>
      </div>
      {isDirty && <p className="text-sm text-amber-800">{tr('unsaved')}</p>}
      {code && <div className="rounded border bg-white p-3 text-sm">
        <p>{tr('codeHelp')}</p>
        <div className="flex items-center gap-2 mt-2">
          <code className="break-all select-all">{code}</code>
          <button type="button" onClick={() => void navigator.clipboard.writeText(code)}
            className="shrink-0 px-2 py-1 rounded border text-xs">{tr('copy')}</button>
        </div>
        <p className="text-xs text-gray-500 mt-1">{tr('expires')}: {new Date(codeExpiry * 1000).toLocaleTimeString()}</p>
      </div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-green-700">{message}</p>}
      <div className="rounded border bg-white p-3 text-xs space-y-1">
        <strong>{tr('currentEntries')}</strong>
        {(person.occupations ?? []).map((entry: any, index: number) =>
          <p key={`o-${index}`}>{tr('occupation')} #{index + 1}: {entry.label} · {entry.institution || entry.place_key || ''} · {dateText(entry.date_from)} – {dateText(entry.date_to)}</p>)}
        {(person.education ?? []).map((entry: any, index: number) =>
          <p key={`e-${index}`}>{tr('education')} #{index + 1}: {entry.institution} · {dateText(entry.date_from)} – {dateText(entry.date_to)}</p>)}
        {!person.occupations?.length && !person.education?.length && <p>{tr('none')}</p>}
      </div>
      {proposals.length === 0 && <p className="text-sm text-gray-500">{tr('empty')}</p>}
      {proposals.map(proposal => {
        const stale = proposal.base_updated_at !== person.updated_at;
        return <div key={proposal.proposal_id} className="rounded-lg border bg-white p-3 space-y-3">
          <div className="text-xs text-gray-500">{tr('proposal')} · {new Date(proposal.created_at * 1000).toLocaleString()}</div>
          {stale && <p className="text-sm text-amber-800">{tr('stale')}</p>}
          {proposal.items.map((item, index) => {
            const existing = item.kind === 'occupation'
              ? person.occupations?.[item.existing_index ?? -1]
              : person.education?.[item.existing_index ?? -1];
            const checked = (selected[proposal.proposal_id] ?? []).includes(index);
            return <div key={index} className="rounded border p-3 text-sm space-y-1">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={checked} disabled={!canSelect(item) || stale || isDirty || busy}
                  onChange={() => setSelected(current => {
                    const values = current[proposal.proposal_id] ?? [];
                    return { ...current, [proposal.proposal_id]: checked
                      ? values.filter(value => value !== index) : [...values, index] };
                  })} />
                <strong>{item.kind === 'occupation' ? tr('occupation') : tr('education')}: {item.raw_occupation || item.raw_institution}</strong>
              </label>
              {item.kind === 'occupation' && item.raw_institution && <p>{tr('institution')}: {item.raw_institution}</p>}
              {item.kind === 'education' && item.edu_type && <p>{tr('eventType')}: {item.edu_type}</p>}
              <p>{tr('period')}: {dateText(item.date_from)} – {dateText(item.date_to)}</p>
              <p className="text-xs font-mono">{[item.occupation_key, item.institution_key, item.place_key].filter(Boolean).join(' · ') || tr('noKey')}</p>
              {Object.entries(item.registry_labels ?? {}).map(([key, label]) =>
                <p key={key} className="text-xs text-blue-800">{tr('registryMatch')}: {label} ({key.replace('_key', '')})</p>)}
              {item.occupation_variant && <p className="text-xs text-blue-800">{tr('matchedVariant')}: {item.occupation_variant}</p>}
              {item.institution_variant && <p className="text-xs text-blue-800">{tr('matchedVariant')}: {item.institution_variant}</p>}
              {item.institution_key && <p className="text-xs text-blue-800">{tr('institutionPlace')}: {item.institution_place_key || tr('noMappedPlace')}</p>}
              {existing && <p className="text-xs text-amber-800">{tr('existing')} #{(item.existing_index ?? 0) + 1}: {(existing as any).label || (existing as any).institution}</p>}
              {item.match_status === 'already_present' && canSelect(item) && <p className="text-xs text-blue-800">{tr('addEvidence')}</p>}
              {!canSelect(item) && <p className="text-xs text-amber-800">{tr(`status.${item.match_status}`)}</p>}
              {item.review_error && <p className="text-xs text-red-700">{tr('registryMissing')}: {item.review_error}</p>}
              <div className="text-xs text-gray-600 space-y-1">
                {item.evidence.map((source, sourceIndex) => <p key={sourceIndex}>
                  {source.source_kind} · {source.work_id
                    ? <Link className="text-blue-700 underline" to={`/work/${encodeURIComponent(source.work_id)}/${source.page ?? 1}`}>
                      {source.work_id}{source.page ? `, ${tr('page')} ${source.page}` : ''}
                    </Link>
                    : source.source_id || source.url}
                  {source.printed_page ? ` (${tr('printedPage')} ${source.printed_page})` : ''} {source.locator || ''}
                  {source.part_id ? ` · ${tr('part')} ${source.part_id}` : ''}
                  {source.quote && <q className="block">{source.quote}</q>}
                </p>)}
              </div>
            </div>;
          })}
          <button type="button" disabled={busy || isDirty || stale || !(selected[proposal.proposal_id]?.length)}
            onClick={() => void apply(proposal)}
            className="px-3 py-1.5 rounded bg-green-700 text-white text-sm disabled:opacity-50">
            {tr('applySelected')} ({selected[proposal.proposal_id]?.length ?? 0})
          </button>
        </div>;
      })}
    </section>
  );
}
