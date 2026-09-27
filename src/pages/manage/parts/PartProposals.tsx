/**
 * Agendi osade ettepanekud „Osad" vahekaardil (#492 samm 2, ADR 0058 täiendus).
 * Agent esitab MCP kaudu ainult ootel ettepaneku; siin otsustab toimetaja osa kaupa.
 * „Lisa" ja „Muuda ja lisa" loovad osa serveris create_part'iga (ADR 0057).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, Copy, Pencil, RefreshCw, X } from 'lucide-react';
import {
  createPartsHandoff, decidePartProposal, listPartProposals,
  type PartProposal, type PartProposalItem, type PartsHandoff, type WorkPart,
} from '../../../services/workPartsApi';
import { compactNumbers } from '../partsModel';
import ProposedPersons from './ProposedPersons';

interface Props {
  workId: string;
  token: string | null;
  /** Suureneb, kui vorm on ettepaneku vastu võtnud — nimekiri laeb uuesti. */
  refreshKey: number;
  onPreview: (stems: string[]) => void;
  onEdit: (proposalId: string, index: number, item: PartProposalItem) => void;
  onChanged: () => void;
  /** Teose praegused osad — parandatava osa nimi. */
  parts: WorkPart[];
}

const PartProposals: React.FC<Props> = ({ workId, token, refreshKey, onPreview, onEdit, onChanged, parts }) => {
  const { t, i18n } = useTranslation(['workspace']);
  const tp = (key: string, opts?: Record<string, unknown>) => t(`manage.parts.proposals.${key}`, opts);
  const [proposals, setProposals] = useState<PartProposal[]>([]);
  const [handoff, setHandoff] = useState<PartsHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProposals(await listPartProposals(workId, token));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workId, token]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decide = (pid: string, index: number, action: 'accept' | 'reject', mode?: 'create') => run(async () => {
    await decidePartProposal(workId, pid, index, action, token, undefined, mode);
    await load();
    if (action === 'accept') onChanged();
  });

  const pending = proposals.flatMap(p => p.items.map((item, index) => ({ p, item, index })))
    .filter(x => x.item.status === 'pending');

  // Lisa viitab oma kirjale, mis peab olema enne vastu võetud → lisad viimasena.
  const acceptAll = () => run(async () => {
    const order = [...pending].sort((a, b) =>
      Number(a.item.part.kind === 'attachment') - Number(b.item.part.kind === 'attachment'));
    try {
      for (const { p, index } of order) await decidePartProposal(workId, p.proposal_id, index, 'accept', token);
    } finally {
      await load();
      onChanged();
    }
  });

  const creators = (item: PartProposalItem) => (item.part.creators ?? [])
    .map(c => `${c.name || c.id} (${t(`metadata.roles.${c.role}`, { defaultValue: c.role })})`).join(', ');

  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-sm" aria-label={tp('title')}>
      <div className="flex flex-wrap items-center gap-2">
        <Bot size={16} className="text-violet-700" />
        <h3 className="font-semibold text-violet-900">{tp('title')}</h3>
        <span className="tabular-nums text-violet-700">({pending.length})</span>
        {pending.length > 1 && (
          <button type="button" disabled={busy} onClick={() => void acceptAll()}
            className="ml-auto flex items-center gap-1 rounded bg-violet-700 px-2.5 py-1 text-white hover:bg-violet-800 disabled:opacity-50">
            <Check size={14} /> {tp('acceptAll', { count: pending.length })}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => run(async () => setHandoff(await createPartsHandoff(workId, token)))}
          className={`${pending.length > 1 ? '' : 'ml-auto '}rounded border border-violet-300 bg-white px-2.5 py-1 text-violet-800 hover:bg-violet-100 disabled:opacity-50`}>
          {tp('createCode')}
        </button>
        <button type="button" disabled={busy} onClick={() => void run(load)} aria-label={tp('refresh')} title={tp('refresh')}
          className="rounded p-1.5 text-violet-700 hover:bg-violet-100 disabled:opacity-50">
          <RefreshCw size={14} />
        </button>
      </div>

      {handoff && (
        <div className="mt-2 rounded border border-violet-200 bg-white p-2">
          <p className="text-xs text-gray-600">{tp('codeHelp', { workId, max: handoff.max_uses })}</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all select-all text-xs">{handoff.code}</code>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(handoff.code).catch(() => {}); }}
              className="flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-xs"><Copy size={12} /> {tp('copy')}</button>
          </div>
          <p className="mt-1 text-xs text-gray-500">{tp('expires')}: {new Date(handoff.expires_at * 1000).toLocaleString()}</p>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
      {proposals.some(p => p.pages_changed) && <p className="mt-2 text-amber-800">{tp('pagesChanged')}</p>}

      <ProposedPersons workId={workId} token={token} lang={i18n.language}
        entries={proposals.flatMap(p => (p.persons ?? []).map(person => ({ proposalId: p.proposal_id, person })))}
        onResolved={() => void load()} />

      {pending.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {pending.map(({ p, item, index }) => (
            <li key={`${p.proposal_id}-${index}`}
              className="flex flex-wrap items-start gap-2 rounded border border-violet-100 bg-white px-2.5 py-1.5"
              onMouseEnter={() => onPreview(item.part.pages)} onMouseLeave={() => onPreview([])}>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900">
                  {t(`manage.parts.kinds.${item.part.kind}`)}{item.part.title ? `: ${item.part.title}` : ''}
                  <span className="ml-2 font-normal text-gray-500">{tp('pages', { pages: compactNumbers(item.page_numbers) })}</span>
                  {item.part.dating?.start && <span className="ml-2 font-normal text-gray-500">{item.part.dating.start}</span>}
                </div>
                {creators(item) && <div className="text-xs text-gray-600">{creators(item)}</div>}
                {item.evidence?.[0]?.quote && <div className="text-xs italic text-gray-500">„{item.evidence[0].quote}"</div>}
                {item.missing_pages.length > 0 && <div className="text-xs text-amber-800">{tp('missingPages', { count: item.missing_pages.length })}</div>}
                {item.target_part_id && (() => {
                  const tgt = parts.find(x => x.id === item.target_part_id);
                  const label = tgt ? (tgt.title || t(`manage.parts.kinds.${tgt.kind}`)) : item.target_part_id;
                  return <div className="text-xs font-medium text-violet-800">{tp('updatesExisting', { label })}</div>;
                })()}
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" disabled={busy} onClick={() => void decide(p.proposal_id, index, 'accept')}
                  className="flex items-center gap-1 rounded bg-violet-700 px-2 py-1 text-xs text-white hover:bg-violet-800 disabled:opacity-50">
                  <Check size={12} /> {item.target_part_id ? tp('update') : tp('accept')}
                </button>
                {item.target_part_id && (
                  <button type="button" disabled={busy} onClick={() => void decide(p.proposal_id, index, 'accept', 'create')}
                    className="rounded border border-violet-300 px-2 py-1 text-xs text-violet-800 hover:bg-violet-50 disabled:opacity-50">
                    {tp('addAsNew')}
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => onEdit(p.proposal_id, index, item)}
                  className="flex items-center gap-1 rounded border border-violet-300 px-2 py-1 text-xs text-violet-800 hover:bg-violet-50 disabled:opacity-50">
                  <Pencil size={12} /> {tp('edit')}
                </button>
                <button type="button" disabled={busy} onClick={() => void decide(p.proposal_id, index, 'reject')}
                  className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                  <X size={12} /> {tp('reject')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {pending.length === 0 && !handoff && <p className="mt-1 text-xs text-gray-600">{tp('empty')}</p>}
    </section>
  );
};

export default PartProposals;
