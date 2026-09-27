import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ProsopoRecord } from '../../types';
import {
  applyEnrichmentProposal, createEnrichmentHandoff, listEnrichmentProposals,
  type EnrichmentCorrection, type EnrichmentItem, type EnrichmentProposal,
  type EnrichmentRegistryCandidate, type EnrichmentDate,
} from '../../services/prosopographyService';
import RegistryCandidatePicker from './RegistryCandidatePicker';
import DateField from './DateField';
import { emptyDateDraft, type DateDraft } from './types';

interface Props {
  person: ProsopoRecord;
  token: string;
  isDirty: boolean;
  onApplied: (person: ProsopoRecord) => void;
}

const dateText = (value?: EnrichmentDate | null) =>
  value ? [value.date, value.precision, value.bound, value.calendar, value.is_circa ? 'circa' : ''].filter(Boolean).join(' · ') : '…';

const toDateDraft = (value?: EnrichmentDate | null): DateDraft => {
  if (!value) return emptyDateDraft();
  const parts = value.date.split('-');
  return {
    ...emptyDateDraft(), year: parts[0] ?? '',
    month: value.precision === 'year' ? '' : String(Number(parts[1] || 0) || ''),
    day: value.precision === 'day' ? String(Number(parts[2] || 0) || '') : '',
    circa: Boolean(value.is_circa), bound: (value.bound as DateDraft['bound']) || '',
    calendar: (value.calendar as DateDraft['calendar']) || '',
  };
};

const fromDateDraft = (value: DateDraft): EnrichmentDate | null => {
  if (!value.year.trim()) return null;
  const precision = value.day && value.month ? 'day' : value.month ? 'month' : 'year';
  return {
    date: `${value.year.padStart(4, '0')}-${(value.month || '1').padStart(2, '0')}-${(value.day || '1').padStart(2, '0')}`,
    precision, ...(value.bound ? { bound: value.bound } : {}),
    ...(value.calendar ? { calendar: value.calendar } : {}), is_circa: value.circa,
  };
};

export default function AgentEnrichmentPanel({ person, token, isDirty, onApplied }: Props) {
  const { t } = useTranslation('prosopography');
  const tr = (key: string) => t(`agentEnrichment.${key}`);
  const [proposals, setProposals] = useState<EnrichmentProposal[]>([]);
  const [code, setCode] = useState('');
  const [codeExpiry, setCodeExpiry] = useState(0);
  const [codeScope, setCodeScope] = useState<{ any: boolean; max: number }>({ any: false, max: 0 });
  const [selected, setSelected] = useState<Record<string, number[]>>({});
  const [corrections, setCorrections] = useState<Record<string, Record<number, EnrichmentCorrection>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try { setProposals(await listEnrichmentProposals(person.id, token)); }
    catch (err) { setError((err as Error).message); }
  }, [person.id, token]);

  useEffect(() => {
    setCode(''); setSelected({}); setCorrections({});
    void refresh();
  }, [refresh]);

  const createCode = async (anyPerson = false) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await createEnrichmentHandoff(anyPerson ? null : person.id, token);
      setCode(result.code); setCodeExpiry(result.expires_at);
      setCodeScope({ any: result.scope === 'any', max: result.max_uses ?? 0 });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const apply = async (proposal: EnrichmentProposal) => {
    const indices = selected[proposal.proposal_id] ?? [];
    if (isDirty || !indices.length || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const selectedCorrections = Object.fromEntries(indices
        .filter(index => corrections[proposal.proposal_id]?.[index])
        .map(index => [index, corrections[proposal.proposal_id][index]]));
      const updated = await applyEnrichmentProposal(person.id, proposal.proposal_id, indices, token,
        selectedCorrections);
      onApplied(updated);
      setCode(''); setSelected({}); setCorrections({});
      await refresh();
      setMessage(tr('saved'));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const canSelect = (item: EnrichmentItem, patch: EnrichmentCorrection = {}) => {
    if (item.review_error && !('occupation_key' in patch || 'institution_key' in patch || 'place_key' in patch)) return false;
    if (item.match_status === 'matched') return true;
    if (item.match_status === 'already_present') return item.existing_index !== undefined
      && Boolean(item.kind === 'occupation' ? item.occupation_key : item.institution_key);
    return Boolean(item.kind === 'occupation' ? patch.occupation_key : patch.institution_key);
  };

  const updateCorrection = (proposalId: string, index: number, patch: EnrichmentCorrection) =>
    setCorrections(current => ({ ...current, [proposalId]: {
      ...current[proposalId], [index]: { ...current[proposalId]?.[index], ...patch },
    } }));

  const chooseCandidate = (proposalId: string, index: number,
    kind: 'occupation' | 'institution', candidate: EnrichmentRegistryCandidate) => {
    const change: EnrichmentCorrection = kind === 'occupation'
      ? { occupation_key: candidate.key, occupation_variant: candidate.matched_variant }
      : { institution_key: candidate.key, institution_variant: candidate.matched_variant,
          place_key: null };
    updateCorrection(proposalId, index, change);
  };

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3" aria-label={tr('title')}>
      <h3 className="font-semibold text-sm">{tr('title')}</h3>
      <p className="text-xs text-gray-600">{tr('intro')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void createCode()} disabled={busy || isDirty}
          className="px-3 py-1.5 rounded bg-blue-700 text-white text-sm disabled:opacity-50">{tr('createCode')}</button>
        <button type="button" onClick={() => void createCode(true)} disabled={busy}
          className="px-3 py-1.5 rounded border border-blue-700 text-blue-800 text-sm disabled:opacity-50">{tr('createCodeAny')}</button>
        <button type="button" onClick={() => void refresh()} disabled={busy}
          className="px-3 py-1.5 rounded border border-blue-300 text-sm disabled:opacity-50">{tr('refresh')}</button>
      </div>
      {isDirty && <p className="text-sm text-amber-800">{tr('unsaved')}</p>}
      {code && <div className="rounded border bg-white p-3 text-sm">
        <p>{codeScope.any ? t('agentEnrichment.codeHelpAny', { max: codeScope.max }) : t('agentEnrichment.codeHelp', { max: codeScope.max })}</p>
        <div className="flex items-center gap-2 mt-2">
          <code className="break-all select-all">{code}</code>
          <button type="button" onClick={() => void navigator.clipboard.writeText(code)}
            className="shrink-0 px-2 py-1 rounded border text-xs">{tr('copy')}</button>
        </div>
        <p className="text-xs text-gray-500 mt-1">{tr('expires')}: {new Date(codeExpiry * 1000).toLocaleString()}</p>
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
            const patch = corrections[proposal.proposal_id]?.[index] ?? {};
            const effective = { ...item, ...patch };
            const existing = item.kind === 'occupation'
              ? person.occupations?.[item.existing_index ?? -1]
              : person.education?.[item.existing_index ?? -1];
            const checked = (selected[proposal.proposal_id] ?? []).includes(index);
            return <div key={index} className="rounded border p-3 text-sm space-y-1">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={checked} disabled={!canSelect(item, patch) || stale || isDirty || busy}
                  onChange={() => setSelected(current => {
                    const values = current[proposal.proposal_id] ?? [];
                    return { ...current, [proposal.proposal_id]: checked
                      ? values.filter(value => value !== index) : [...values, index] };
                  })} />
                <strong>{item.kind === 'occupation' ? tr('occupation') : tr('education')}: {item.raw_occupation || item.raw_institution}</strong>
              </label>
              {item.kind === 'occupation' && item.raw_institution && <p>{tr('institution')}: {item.raw_institution}</p>}
              {item.kind === 'education' && item.edu_type && <p>{tr('eventType')}: {item.edu_type}</p>}
              <p>{tr('period')}: {dateText(effective.date_from)} – {dateText(effective.date_to)}</p>
              <p className="text-xs font-mono">{[item.occupation_key, item.institution_key, item.place_key].filter(Boolean).join(' · ') || tr('noKey')}</p>
              {Object.entries(item.registry_labels ?? {}).map(([key, label]) =>
                <p key={key} className="text-xs text-blue-800">{tr('registryMatch')}: {label} ({key.replace('_key', '')})</p>)}
              {item.occupation_variant && <p className="text-xs text-blue-800">{tr('matchedVariant')}: {item.occupation_variant}</p>}
              {item.institution_variant && <p className="text-xs text-blue-800">{tr('matchedVariant')}: {item.institution_variant}</p>}
              {item.institution_key && <p className="text-xs text-blue-800">{tr('institutionPlace')}: {item.institution_place_key || tr('noMappedPlace')}</p>}
              {existing && <p className="text-xs text-amber-800">{tr('existing')} #{(item.existing_index ?? 0) + 1}: {(existing as any).label || (existing as any).institution}</p>}
              {Object.keys(patch).length > 0 && <p className="text-xs font-semibold text-green-800">{tr('editorChoice')}: {[effective.occupation_key, effective.institution_key, effective.place_key].filter(Boolean).join(' · ')}</p>}
              {item.match_status === 'already_present' && canSelect(item, patch) && <p className="text-xs text-blue-800">{
                existing && !(item.kind === 'occupation' ? (existing as any).occupation_key : (existing as any).institution_key)
                  ? tr('linkExisting') : tr('addEvidence')
              }</p>}
              {!canSelect(item, patch) && <p className="text-xs text-amber-800">{tr(`status.${item.match_status}`)}</p>}
              {item.review_error && <p className="text-xs text-red-700">{Object.keys(patch).length ? tr('originalWarning') : tr('registryMissing')}: {item.review_error}</p>}
              {item.match_status !== 'already_present' && <div className="space-y-2">
                {item.kind === 'occupation' && <RegistryCandidatePicker kind="occupation"
                  query={item.raw_occupation ?? ''} disabled={stale || isDirty || busy}
                  chosenKey={patch.occupation_key}
                  onSelect={candidate => chooseCandidate(proposal.proposal_id, index, 'occupation', candidate)} />}
                {(item.kind === 'education' || item.raw_institution) && <RegistryCandidatePicker kind="institution"
                  query={item.raw_institution ?? ''} disabled={stale || isDirty || busy}
                  chosenKey={patch.institution_key}
                  onSelect={candidate => chooseCandidate(proposal.proposal_id, index, 'institution', candidate)} />}
              </div>}
              <details className="rounded border border-gray-200 p-2">
                <summary className="cursor-pointer text-xs text-blue-700">{tr('correctDetails')}</summary>
                <div className="mt-2 space-y-2">
                  {item.match_status !== 'already_present' && <>
                    <div className="grid grid-cols-2 gap-2">
                      <DateField label={tr('from')} showPlace={false}
                        value={toDateDraft('date_from' in patch ? patch.date_from : item.date_from)}
                        onChange={value => updateCorrection(proposal.proposal_id, index, { date_from: fromDateDraft(value) })} />
                      <DateField label={tr('to')} showPlace={false}
                        value={toDateDraft('date_to' in patch ? patch.date_to : item.date_to)}
                        onChange={value => updateCorrection(proposal.proposal_id, index, { date_to: fromDateDraft(value) })} />
                    </div>
                    {item.kind === 'education' && <label className="block text-xs">{tr('eventType')}
                      <input value={patch.edu_type ?? item.edu_type ?? ''}
                        onChange={event => updateCorrection(proposal.proposal_id, index, { edu_type: event.target.value })}
                        className="block w-full rounded border px-2 py-1" />
                    </label>}
                  </>}
                  {(patch.evidence ?? item.evidence).map((source, sourceIndex) => {
                    const editSource = (changes: Partial<typeof source>) => {
                      const evidence = [...(patch.evidence ?? item.evidence)];
                      evidence[sourceIndex] = { ...source, ...changes };
                      updateCorrection(proposal.proposal_id, index, { evidence });
                    };
                    return <div key={sourceIndex} className="grid grid-cols-2 gap-2 text-xs">
                      {source.source_kind === 'vutt_page' && <label>{tr('page')}
                        <input type="number" min={1} value={source.page ?? ''}
                          onChange={event => editSource({ page: Number(event.target.value) })}
                          className="block w-full rounded border px-2 py-1" />
                      </label>}
                      <label>{tr('locator')}
                        <input value={source.locator ?? ''}
                          onChange={event => editSource({ locator: event.target.value })}
                          className="block w-full rounded border px-2 py-1" />
                      </label>
                      <label>{tr('printedPage')}
                        <input value={source.printed_page ?? ''}
                          onChange={event => editSource({ printed_page: event.target.value })}
                          className="block w-full rounded border px-2 py-1" />
                      </label>
                      <label className="col-span-2">{tr('quote')}
                        <input value={source.quote ?? ''}
                          onChange={event => editSource({ quote: event.target.value })}
                          className="block w-full rounded border px-2 py-1" />
                      </label>
                    </div>;
                  })}
                </div>
              </details>
              <div className="text-xs text-gray-600 space-y-1">
                {(patch.evidence ?? item.evidence).map((source, sourceIndex) => <p key={sourceIndex}>
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
