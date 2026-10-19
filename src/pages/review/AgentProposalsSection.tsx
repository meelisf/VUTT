import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import { listPacks, type TextProposalPack } from '../../services/textProposalService';

// Agendi tekstiettepanekute pakid (#641) — ainult superadmin (kontroll Review lehel).
// Kood agendile antakse teose halduses („Osad" → „Kood agendile"), mitte siin.
export default function AgentProposalsSection({ token }: { token: string }) {
  const { t } = useTranslation(['review', 'common']);
  const navigate = useNavigate();
  const [packs, setPacks] = useState<TextProposalPack[]>([]);
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
      </div>
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
