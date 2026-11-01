import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import {
  createAgentHandoff, listAgentProposals, type AgentHandoff, type AgentProposal,
} from '../../services/agentProposalsService';
import CopyButton from '../../components/CopyButton';

// Agendi ettepanekud ühes loendis (ADR 0058, 2026-10-20) — ainult superadmin
// (kontroll Review lehel). Siin ainult ülevaade ja kood; otsus käib sihtvaates.
export default function AgentProposalsSection({ token }: { token: string }) {
  const { t } = useTranslation(['review', 'common']);
  const navigate = useNavigate();
  const [rows, setRows] = useState<AgentProposal[]>([]);
  const [handoff, setHandoff] = useState<AgentHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAgentProposals(token).then(setRows, (e: Error) => setError(e.message));
  }, [token]);

  const createCode = async () => {
    setBusy(true);
    setError(null);
    try {
      setHandoff(await createAgentHandoff(token));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Võtmed sõnasõnaliselt — i18n valvur otsib neid lähtekoodist.
  const kindLabel: Record<AgentProposal['kind'], string> = {
    text: t('proposals.kind.text'),
    parts: t('proposals.kind.parts'),
    person: t('proposals.kind.person'),
    exemplars: t('proposals.kind.exemplars'),
  };

  return (
    <div className="mx-6 my-4 rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
      <div className="flex flex-wrap items-center gap-2">
        <Bot size={16} />
        <h2 className="font-semibold">{t('proposals.title')}</h2>
        <button type="button" disabled={busy} onClick={() => void createCode()}
          className="ml-auto rounded border border-violet-300 bg-white px-2.5 py-1 text-violet-800 hover:bg-violet-100 disabled:opacity-50">
          {t('proposals.createCode')}
        </button>
      </div>
      {handoff && (
        <div className="mt-2 rounded border border-violet-200 bg-white p-2">
          <p className="text-xs text-gray-600">{t('proposals.codeHelp', { ...handoff.max_uses })}</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all select-all text-xs">{handoff.code}</code>
            <CopyButton text={handoff.code} label={t('proposals.copy')} copiedLabel={t('proposals.copied')} />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {t('proposals.expires')}: {new Date(handoff.expires_at * 1000).toLocaleString()}
          </p>
        </div>
      )}
      {error && <div className="mt-2 text-red-700">{t('proposals.error', { error })}</div>}
      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-violet-100">
          {rows.map(row => (
            <li key={`${row.kind}:${row.proposal_id}`}>
              <button type="button" onClick={() => navigate(row.target_url)}
                className="flex w-full flex-wrap items-baseline gap-x-3 py-2 text-left hover:bg-violet-100">
                <span className="rounded bg-violet-100 px-1.5 text-xs">{kindLabel[row.kind]}</span>
                <span className="flex-1">{row.target_label}</span>
                <span className="text-xs">{t('proposals.pending', { count: row.pending })}</span>
                {row.stale !== null && row.kind === 'parts' && row.stale > 0 && (
                  <span className="text-xs text-amber-800">{t('proposals.pagesChanged')}</span>
                )}
                {row.stale !== null && row.kind === 'exemplars' && row.stale > 0 && (
                  <span className="text-xs text-amber-800">{t('proposals.blocked', { count: row.stale })}</span>
                )}
                {row.stale !== null && row.kind !== 'parts' && row.kind !== 'exemplars' && row.stale > 0 && (
                  <span className="text-xs text-amber-800">{t('proposals.stale', { count: row.stale })}</span>
                )}
                <span className="text-xs text-violet-700">{new Date(row.created_at * 1000).toLocaleDateString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
