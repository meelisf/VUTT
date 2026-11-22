import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bot } from 'lucide-react';
import {
  createAgentHandoff, listAgentProposals, type AgentHandoff, type AgentProposal,
} from '../../../services/agentProposalsService';
import CopyButton from '../../../components/CopyButton';

// Agendikood ja ootel ettepanekud ühes loendis (ADR 0058, 2026-10-20; #869).
// Õiguse kontroll on lehel (`Agents.tsx`) ja serveris. Server annab adminile ainult
// tema koodiga tulnud read, superadminile kõik — `showOwner` lisab esitaja veeru ja
// filtri. Siin ainult ülevaade ja kood; otsus käib sihtvaates.
export default function AgentProposalsPanel({ token, showOwner = false }: {
  token: string;
  showOwner?: boolean;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const navigate = useNavigate();
  const [rows, setRows] = useState<AgentProposal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [owner, setOwner] = useState('');
  const [handoff, setHandoff] = useState<AgentHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAgentProposals(token).then(
      r => { setRows(r); setLoaded(true); },
      (e: Error) => setError(e.message),
    );
  }, [token]);

  const owners = useMemo(
    () => [...new Set(rows.map(r => r.username))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const visible = showOwner && owner ? rows.filter(r => r.username === owner) : rows;

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
    text: t('agents.kind.text'),
    parts: t('agents.kind.parts'),
    person: t('agents.kind.person'),
    exemplars: t('agents.kind.exemplars'),
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">
        <div className="flex flex-wrap items-center gap-2">
          <Bot size={16} />
          <h2 className="font-semibold">{t('agents.codeTitle')}</h2>
          <button type="button" disabled={busy} onClick={() => void createCode()}
            className="ml-auto rounded border border-violet-300 bg-white px-2.5 py-1 text-violet-800 hover:bg-violet-100 disabled:opacity-50">
            {t('agents.createCode')}
          </button>
        </div>
        {handoff && (
          <div className="mt-2 rounded border border-violet-200 bg-white p-2">
            <p className="text-xs text-gray-600">{t('agents.codeHelp', { ...handoff.max_uses })}</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all select-all text-xs">{handoff.code}</code>
              <CopyButton text={handoff.code} label={t('agents.copy')} copiedLabel={t('agents.copied')} />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {t('agents.expires')}: {new Date(handoff.expires_at * 1000).toLocaleString()}
            </p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-gray-800">{t('agents.proposalsTitle')}</h2>
          {showOwner && owners.length > 0 && (
            <label className="ml-auto flex items-center gap-2 text-xs text-gray-600">
              {t('agents.filterOwner')}
              <select value={owner} onChange={e => setOwner(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="">{t('agents.allOwners')}</option>
                {owners.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          )}
        </div>
        {error && <div className="mt-2 text-red-700">{t('agents.error', { error })}</div>}
        {loaded && visible.length === 0 && (
          <p className="mt-2 text-gray-500">{t('agents.empty')}</p>
        )}
        {visible.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-100">
            {visible.map(row => (
              <li key={`${row.kind}:${row.proposal_id}`}>
                <button type="button" onClick={() => navigate(row.target_url)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 py-2 text-left hover:bg-violet-50">
                  <span className="rounded bg-violet-100 px-1.5 text-xs text-violet-900">{kindLabel[row.kind]}</span>
                  <span className="flex-1">{row.target_label}</span>
                  {showOwner && <span className="font-mono text-xs text-gray-500">{row.username}</span>}
                  <span className="text-xs">{t('agents.pending', { count: row.pending })}</span>
                  {row.stale !== null && row.kind === 'parts' && row.stale > 0 && (
                    <span className="text-xs text-amber-800">{t('agents.pagesChanged')}</span>
                  )}
                  {row.stale !== null && row.kind === 'exemplars' && row.stale > 0 && (
                    <span className="text-xs text-amber-800">{t('agents.blocked', { count: row.stale })}</span>
                  )}
                  {row.stale !== null && row.kind !== 'parts' && row.kind !== 'exemplars' && row.stale > 0 && (
                    <span className="text-xs text-amber-800">{t('agents.stale', { count: row.stale })}</span>
                  )}
                  <span className="text-xs text-violet-700">{new Date(row.created_at * 1000).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
