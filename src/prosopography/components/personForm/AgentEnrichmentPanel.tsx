import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProsopoRecord } from '../../types';
import {
  applyEnrichmentProposal, createEnrichmentHandoff, EnrichmentApplyError, listEnrichmentProposals,
  rejectEnrichmentProposal, type EnrichmentDate, type EnrichmentItem, type EnrichmentProposal,
} from '../../services/prosopographyService';
import EvidenceList from '../EvidenceList';
import BusyNote from '../../../components/BusyNote';
import CopyButton from '../../../components/CopyButton';
import { useWorkTitles } from '../../hooks/useWorkTitles';
import { evidenceWorkIds } from '../../utils/evidenceRef';

interface Props {
  person: ProsopoRecord;
  token: string;
  isDirty: boolean;
  onApplied: (person: ProsopoRecord) => void;
}

// Põhjuse kood on serveri vea algus („registry_conflict: valipreester"); tundmatu → „other".
const KNOWN_REASONS = new Set(['duplicate_entry', 'unresolved_existing_entry', 'registry_key_missing',
  'ambiguous_match', 'registry_conflict', 'duplicate_id', 'unknown_occupation_key',
  'unknown_institution_key', 'unknown_place_key', 'person_not_found']);

const yearOf = (value?: EnrichmentDate | null) => value?.date?.slice(0, 4) ?? '';
const period = (item: EnrichmentItem) => {
  const from = yearOf(item.date_from), to = yearOf(item.date_to);
  return from || to ? `${from}–${to}` : '';
};

/** Ülevaatus = otsus: Kinnita või Lükka tagasi. Olek tuleb serverist (`review_state`),
 *  parandused tehakse pärast tavalises isikuvormis (spekk 2026-09-28). */
export default function AgentEnrichmentPanel({ person, token, isDirty, onApplied }: Props) {
  const { t } = useTranslation('prosopography');
  const tr = (key: string, options?: Record<string, unknown>) => t(`agentEnrichment.${key}`, options);
  const [proposals, setProposals] = useState<EnrichmentProposal[]>([]);
  const [code, setCode] = useState('');
  const [codeExpiry, setCodeExpiry] = useState(0);
  const [codeScope, setCodeScope] = useState<{ any: boolean; max: number }>({ any: false, max: 0 });
  const [busy, setBusy] = useState(false);
  // Käimasolev otsus: näitab, millise ettepaneku juures töö käib (kinnitus võtab sekundeid).
  const [working, setWorking] = useState<{ proposalId: string; count: number; confirm: boolean } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  // Eelkontrolli viga („items[i]: kood") näidatakse real, kuni järgmine otsus õnnestub.
  const [rowErrors, setRowErrors] = useState<Record<string, Record<number, string>>>({});
  const titles = useWorkTitles(evidenceWorkIds(proposals.flatMap(p => p.items)), token);
  const titleOf = (id: string) => titles[id];

  const refresh = useCallback(async () => {
    try { setProposals(await listEnrichmentProposals(person.id, token)); }
    catch (err) { setError((err as Error).message); }
  }, [person.id, token]);

  useEffect(() => { setCode(''); setError(''); void refresh(); }, [refresh]);

  const createCode = async (anyPerson = false) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await createEnrichmentHandoff(anyPerson ? null : person.id, token);
      setCode(result.code); setCodeExpiry(result.expires_at);
      setCodeScope({ any: result.scope === 'any', max: result.max_uses ?? 0 });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const decide = async (proposal: EnrichmentProposal, indices: number[], confirm: boolean) => {
    if (busy || isDirty || !indices.length) return;
    setBusy(true); setError(''); setMessage('');
    setWorking({ proposalId: proposal.proposal_id, count: indices.length, confirm });
    try {
      if (confirm) {
        onApplied(await applyEnrichmentProposal(person.id, proposal.proposal_id, indices, token, proposal.revision));
        setMessage(tr('saved'));
      } else {
        await rejectEnrichmentProposal(person.id, proposal.proposal_id, indices, token, proposal.revision);
        setMessage(tr('rejected'));
      }
      setRowErrors({});
    } catch (err) {
      const rowError = (err as Error).message.match(/^items\[(\d+)\]: (.+)$/);
      if (err instanceof EnrichmentApplyError) {
        setError(tr('createdButNotSaved', { keys: err.created.join(', ') }));
      } else if (rowError) {
        // Eelkontroll kukkus: registrisse ega kaardile ei kirjutatud midagi.
        setRowErrors({ [proposal.proposal_id]: { [Number(rowError[1])]: rowError[2] } });
        setError(tr('nothingSaved'));
      } else {
        setError((err as Error).message === 'stale_proposal' ? tr('staleProposal') : (err as Error).message);
      }
    } finally {
      // Ka vea järel: rea olek (nt vahepeal tekkinud duplikaat) tuleb serverist.
      await refresh();
      setWorking(null);
      setBusy(false);
    }
  };

  const reasonText = (reason = '') => {
    const reasonCode = reason.match(/^[a-z_]+/)?.[0] ?? '';
    return KNOWN_REASONS.has(reasonCode) ? tr(`reason.${reasonCode}`) : `${tr('reason.other')} (${reason})`;
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
        <p>{codeScope.any ? tr('codeHelpAny', { max: codeScope.max }) : tr('codeHelp', { max: codeScope.max })}</p>
        <div className="flex items-center gap-2 mt-2">
          <code className="break-all select-all">{code}</code>
          <CopyButton text={code} label={tr('copy')} copiedLabel={tr('copied')}
            className="flex shrink-0 items-center gap-1 px-2 py-1 rounded border text-xs" />
        </div>
        <p className="text-xs text-gray-500 mt-1">{tr('expires')}: {new Date(codeExpiry * 1000).toLocaleString()}</p>
      </div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-green-700">{message}</p>}
      {proposals.length === 0 && <p className="text-sm text-gray-500">{tr('empty')}</p>}
      {proposals.map(proposal => {
        const open = proposal.items.map((item, index) => ({ item, index }))
          .filter(({ item }) => item.review_state?.state !== 'blocked').map(({ index }) => index);
        return <div key={proposal.proposal_id} className="rounded-lg border bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-500">
              {tr('proposal')} · {tr('rowCount', { count: proposal.items.length })} · {new Date(proposal.created_at * 1000).toLocaleString()}
              {' · '}{tr('expiresShort')} {new Date(proposal.expires_at * 1000).toLocaleDateString()}
            </div>
            <button type="button" disabled={busy || isDirty || !open.length}
              onClick={() => void decide(proposal, open, true)}
              className="shrink-0 px-3 py-1.5 rounded bg-green-700 text-white text-sm disabled:opacity-50">
              {tr('confirmAll', { count: open.length })}
            </button>
          </div>
          {working?.proposalId === proposal.proposal_id && (
            <BusyNote>{working.confirm ? tr('working', { count: working.count }) : tr('rejecting')}</BusyNote>
          )}
          {proposal.items.map((item, index) => {
            const keyField = item.kind === 'occupation' ? 'occupation_key' : 'institution_key';
            const entry = item.kind === 'occupation' ? item.occupation_entry : item.institution_entry;
            const raw = item.kind === 'occupation' ? item.raw_occupation : item.raw_institution;
            const name = item.registry_labels?.[keyField] || raw || '';
            const state = item.review_state?.state ?? 'blocked';
            const blocked = state === 'blocked';
            const rowError = rowErrors[proposal.proposal_id]?.[index];
            const badge = state === 'already_present' ? tr('badgePresent') : entry ? tr('badgeNew') : tr('badgeRegistry');
            const qid = item.registry_ids?.[keyField] ?? entry?.id;
            const institution = item.kind === 'occupation'
              ? item.registry_labels?.institution_key || item.raw_institution : '';
            return <div key={index} className="flex gap-3 items-start rounded border border-gray-200 p-3 text-sm">
              <div className="flex-1 min-w-0 space-y-1">
                <p>
                  <span className="text-gray-500 mr-1">{item.kind === 'occupation' ? tr('occupation') : tr('education')}</span>
                  <strong>{name}</strong>
                  {qid && <span className="ml-1 font-mono text-xs text-gray-500">{qid}</span>}
                  <span className={`ml-2 inline-block rounded-full px-2 text-xs ${state === 'already_present'
                    ? 'bg-amber-100 text-amber-800' : entry ? 'bg-green-100 text-green-800' : 'bg-sky-100 text-sky-800'}`}>{badge}</span>
                </p>
                <p className="text-xs text-gray-700">
                  {[raw && raw !== name ? `„${raw}"` : '', institution, item.kind === 'education' ? item.edu_type : '', period(item)]
                    .filter(Boolean).join(' · ')}
                </p>
                {entry && <p className="text-xs text-green-800">
                  ＋ {tr('newEntry')} <span className="font-mono">{entry.key}</span>: {Object.values(entry.labels).join(' / ')}
                  {entry.variants?.length ? ` · ${tr('variants')}: ${entry.variants.join(', ')}` : ''}
                </p>}
                <EvidenceList evidence={item.evidence} titleOf={titleOf} />
                {blocked && <p className="text-xs text-amber-800">{reasonText(item.review_state?.reason)}</p>}
                {rowError && !blocked && <p className="text-xs text-red-700">{reasonText(rowError)}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" disabled={busy || isDirty || blocked}
                  onClick={() => void decide(proposal, [index], true)}
                  className="px-2.5 py-1 rounded bg-green-700 text-white text-xs disabled:bg-gray-400">
                  {state === 'already_present' ? tr('addEvidenceShort') : tr('confirm')}
                </button>
                <button type="button" disabled={busy || isDirty}
                  onClick={() => void decide(proposal, [index], false)}
                  className="px-2.5 py-1 rounded border text-xs text-red-700 disabled:opacity-50">{tr('reject')}</button>
              </div>
            </div>;
          })}
        </div>;
      })}
    </section>
  );
}
