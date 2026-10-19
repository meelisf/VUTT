import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { issueHandoff, listPacks, type ProposalHandoff, type TextProposalPack } from '../../services/textProposalService';

// Agendi tekstiettepanekute pakid (#641) — ainult superadmin (kontroll Review lehel).
export default function AgentProposalsSection({ token }: { token: string }) {
  const { t } = useTranslation(['review', 'common']);
  const navigate = useNavigate();
  const [packs, setPacks] = useState<TextProposalPack[]>([]);
  const [handoff, setHandoff] = useState<ProposalHandoff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPacks(token).then(setPacks, (e: Error) => setError(e.message));
  }, [token]);

  const open = (p: TextProposalPack) => {
    const first = p.pages.find(pg => pg.state === 'pending' || pg.state === 'stale');
    navigate(`/work/${p.work_id}/${first?.page_no ?? 1}`);
  };

  return (
    <div className="mx-6 my-4 rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
      <div className="flex flex-wrap items-center gap-2">
        <Bot size={16} />
        <h2 className="font-semibold">{t('proposals.title')}</h2>
        <button type="button" onClick={() => issueHandoff(token).then(setHandoff, (e: Error) => setError(e.message))}
          className="ml-auto rounded border border-violet-300 px-2 py-1 text-xs hover:bg-violet-100">
          {t('proposals.handoffAll')}
        </button>
      </div>
      {handoff && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span>{t('proposals.handoffInfo', {
            time: new Date(handoff.expires_at * 1000).toLocaleString(), uses: handoff.max_uses,
          })}</span>
          <code className="select-all rounded bg-white px-1.5 py-0.5 font-mono">{handoff.code}</code>
        </div>
      )}
      {error && <div className="mt-2 text-red-700">{t('proposals.error', { error })}</div>}
      {packs.length === 0 ? (
        <p className="mt-2 text-xs text-violet-700">{t('proposals.empty')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-violet-100">
          {packs.map(p => (
            <li key={p.proposal_id}>
              <button type="button" onClick={() => open(p)}
                className="flex w-full flex-wrap items-baseline gap-x-3 py-2 text-left hover:bg-violet-100">
                <span className="font-mono text-xs">{p.work_id}</span>
                <span className="flex-1">{p.note || '—'}</span>
                <span className="text-xs">{t('proposals.counts', { pending: p.counts.pending, stale: p.counts.stale })}</span>
                <span className="text-xs text-violet-700">{new Date(p.created_at * 1000).toLocaleDateString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
