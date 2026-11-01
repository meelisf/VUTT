// src/pages/manage/exemplars/ExemplarProposalsTab.tsx
/**
 * Teose halduse vahekaart „Eksemplarid" (#703, ADR 0076 §7): agendi
 * eksemplari-ettepanekud. Ainult superadmin.
 *
 * Ülevaatus = Kinnita või Lükka tagasi (ADR 0058 täiendus 2026-09-29: parandust
 * ettepanekus ei ole — toimetaja parandab pärast kinnitust eksemplari vormis).
 * Valitud read lähevad ühe päringuga = üks commit. Rea oleku (`review_state`)
 * arvutab server elava seisu vastu; klient ei otsusta, mis on kinnitatav.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import type { Exemplar, ExemplarConvolute } from '../../../types';
import { useNotify } from '../../../contexts/FeedbackContext';
import { apiErrorMessage } from '../../../services/apiClient';
import {
  decideExemplarProposals, esterRecordUrl, listExemplarProposals,
  type ExemplarProposal, type ExemplarProposalRow,
} from '../../../services/exemplarProposalsApi';

interface Props {
  workId: string;
  token: string | null;
  onChanged?: () => void;
}

type Pick = { proposal_id: string; index: number };
const keyOf = (p: Pick) => `${p.proposal_id}:${p.index}`;

const ExemplarProposalsTab: React.FC<Props> = ({ workId, token, onChanged }) => {
  const { t } = useTranslation(['workspace', 'common']);
  const notify = useNotify();
  const [proposals, setProposals] = useState<ExemplarProposal[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Laadimine sõltub ainult teosest ja tokenist; tõlkefunktsiooni või teavitaja uus
  // identiteet ei tohi päringut uuesti käivitada.
  const feedback = useRef({ t, notify });
  feedback.current = { t, notify };

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setProposals(await listExemplarProposals(workId, token));
    } catch (e) {
      const { t: tr, notify: say } = feedback.current;
      say(apiErrorMessage(e, tr('manage.exemplarProposals.loadError')), 'error');
      setProposals([]);
    }
  }, [workId, token]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (picks: Pick[], action: 'accept' | 'reject') => {
    if (!token || picks.length === 0) return;
    setBusy(true);
    try {
      await decideExemplarProposals(workId, picks, action, token);
      notify(t(action === 'accept' ? 'manage.exemplarProposals.accepted' : 'manage.exemplarProposals.rejected'),
        'success');
      setSelected(new Set());
      onChanged?.();
    } catch (e) {
      notify(apiErrorMessage(e, (e as Error)?.message || t('manage.exemplarProposals.decideError')), 'error');
    } finally {
      setBusy(false);
      // Ka vea järel: server võis vahepeal muutuda (teine toimetaja, hoidja lisati).
      await load();
    }
  };

  // Võtmed sõnasõnaliselt — i18n valvur otsib neid lähtekoodist.
  const fieldLabel: Record<string, string> = {
    holder: t('exemplars.holder'), shelfmark: t('exemplars.shelfmark'), url: t('exemplars.url'),
    condition: t('exemplars.fields.condition'), binding: t('exemplars.fields.binding'),
    provenance: t('exemplars.fields.provenance'), notes: t('exemplars.fields.notes'),
    convolute: t('exemplars.convolute.label'),
  };

  const formatValue = (field: string, value: unknown): string => {
    if (value == null || value === '') return '—';
    if (field === 'convolute') {
      const c = value as ExemplarConvolute;
      return [
        c.reference,
        c.position != null && (c.position === 0 ? t('common:convolute.main')
          : t('common:convolute.position', { n: c.position })),
        c.total != null && t('common:convolute.total', { count: c.total }),
        c.contents,
      ].filter(Boolean).join(' · ');
    }
    return String(value);
  };

  if (proposals === null) return <p className="text-sm text-gray-500">…</p>;
  if (proposals.length === 0) return <p className="text-sm text-gray-500">{t('manage.exemplarProposals.none')}</p>;

  const pendingPicks = proposals.flatMap(p => p.rows.filter(r => r.review_state === 'pending')
    .map(r => ({ proposal_id: p.proposal_id, index: r.index })));
  const chosen = pendingPicks.filter(p => selected.has(keyOf(p)));

  const toggle = (p: Pick) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(keyOf(p))) next.delete(keyOf(p)); else next.add(keyOf(p));
    return next;
  });

  const fieldList = (row: ExemplarProposalRow) => Object.keys(row.fields) as (keyof Exemplar)[];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 p-4 space-y-4" data-testid="exemplar-proposals">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-gray-800">{t('manage.exemplarProposals.title')}</h2>
        <p className="text-xs text-gray-500 flex-1">{t('manage.exemplarProposals.help')}</p>
        <button type="button" disabled={busy || chosen.length === 0} onClick={() => void decide(chosen, 'accept')}
          className="px-3 py-1.5 rounded text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
          {t('manage.exemplarProposals.acceptSelected')} ({chosen.length})
        </button>
      </div>

      {proposals.map(p => (
        <div key={p.proposal_id} className="space-y-2">
          <p className="text-xs text-gray-500">
            {new Date(p.created_at * 1000).toLocaleString()}
            {p.note && <> · <span className="text-gray-700">{p.note}</span></>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="py-1 pr-2 w-6" />
                  <th className="py-1 pr-2">{t('manage.exemplarProposals.colKind')}</th>
                  <th className="py-1 pr-2">{t('manage.exemplarProposals.colCurrent')}</th>
                  <th className="py-1 pr-2">{t('manage.exemplarProposals.colProposed')}</th>
                  <th className="py-1 pr-2">{t('manage.exemplarProposals.colSource')}</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {p.rows.map(row => {
                  const pick = { proposal_id: p.proposal_id, index: row.index };
                  const decidable = row.review_state === 'pending';
                  const fields = fieldList(row);
                  const cur = row.current;
                  return (
                    <tr key={row.index} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-2">
                        {decidable && (
                          <input type="checkbox" checked={selected.has(keyOf(pick))} disabled={busy}
                            onChange={() => toggle(pick)} aria-label={t('manage.exemplarProposals.select')} />
                        )}
                      </td>
                      <td className="py-2 pr-2 whitespace-nowrap">
                        {row.op === 'create'
                          ? t('manage.exemplarProposals.opCreate')
                          : <>{t('manage.exemplarProposals.opUpdate')}<br />
                            <span className="text-xs text-gray-500">{cur ? `${cur.holder} ${cur.shelfmark ?? ''}`.trim() : row.exemplar_id}</span></>}
                      </td>
                      <td className="py-2 pr-2 text-gray-600">
                        {row.op === 'update' && fields.map(f => (
                          <div key={f}><span className="text-xs text-gray-400">{fieldLabel[f] ?? f}:</span> {formatValue(f, cur?.[f])}</div>
                        ))}
                      </td>
                      <td className="py-2 pr-2">
                        {fields.map(f => {
                          const changed = row.op === 'create'
                            || JSON.stringify(cur?.[f] ?? null) !== JSON.stringify(row.fields[f] ?? null);
                          return (
                            <div key={f} className={changed ? 'font-semibold' : ''}>
                              <span className="text-xs text-gray-400 font-normal">{fieldLabel[f] ?? f}:</span> {formatValue(f, row.fields[f])}
                            </div>
                          );
                        })}
                      </td>
                      <td className="py-2 pr-2 max-w-xs">
                        <a href={esterRecordUrl(row.source.ref)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary-700 hover:underline text-xs">
                          <ExternalLink size={11} />ESTER {row.source.ref}
                        </a>
                        <blockquote className="text-xs text-gray-600 italic whitespace-pre-wrap">{row.source.quote}</blockquote>
                      </td>
                      <td className="py-2 whitespace-nowrap text-right">
                        {decidable ? (
                          <div className="flex gap-2 justify-end">
                            <button type="button" disabled={busy} onClick={() => void decide([pick], 'accept')}
                              className="text-xs font-medium text-green-700 hover:text-green-900 disabled:opacity-50">
                              {t('manage.exemplarProposals.accept')}
                            </button>
                            <button type="button" disabled={busy} onClick={() => void decide([pick], 'reject')}
                              className="text-xs font-medium text-red-700 hover:text-red-900 disabled:opacity-50">
                              {t('manage.exemplarProposals.reject')}
                            </button>
                          </div>
                        ) : (
                          <span className={`text-xs ${row.review_state === 'accepted' ? 'text-green-700'
                            : row.review_state === 'rejected' ? 'text-gray-500' : 'text-amber-700'}`}>
                            {t(`manage.exemplarProposals.state.${row.review_state}`)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ExemplarProposalsTab;
