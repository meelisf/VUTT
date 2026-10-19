import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { diffWords } from '../../utils/textDiff';
import type { ProposalJob, ProposalPageReview, TextProposalPack } from '../../services/textProposalService';

interface TextProposalPanelProps {
  review: ProposalPageReview | null;
  pack: TextProposalPack | null;
  pendingNotLoaded: boolean;
  loaded: boolean;
  job: ProposalJob | null;
  error: string | null;
  onLoad: () => void;
  onReject: () => void;
  onRejectPack: () => void;
  onAcceptPack: () => void;
  onSaveAndNext: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onHandoff: () => void;
  handoff: { code: string; expires_at: number; max_uses: number } | null;
}

// Agendi tekstiettepaneku riba redaktori kohal (#641; ainult superadmin).
export default function TextProposalPanel(p: TextProposalPanelProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const [copied, setCopied] = useState(false);
  const remaining = p.pack ? p.pack.counts.pending + p.pack.counts.stale : 0;
  const staleDiff = useMemo(
    () => (p.review?.state === 'stale' ? diffWords(p.review.base_text, p.review.proposed_text) : null),
    [p.review],
  );
  const running = p.job?.state === 'running';

  return (
    <div className="shrink-0 border-b border-violet-200 bg-violet-50 px-4 py-2 text-xs text-violet-900 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Bot size={14} className="shrink-0" />
        <span className="font-semibold">{t('proposal.title')}</span>
        {p.pack && <span>{t('proposal.remaining', { count: remaining })}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {p.onPrev && (
            <button type="button" onClick={p.onPrev} className="inline-flex items-center px-1.5 py-0.5 rounded hover:bg-violet-100">
              <ChevronLeft size={14} />{t('proposal.prev')}
            </button>
          )}
          {p.onNext && (
            <button type="button" onClick={p.onNext} className="inline-flex items-center px-1.5 py-0.5 rounded hover:bg-violet-100">
              {t('proposal.next')}<ChevronRight size={14} />
            </button>
          )}
          {p.review && (
            <>
              {p.loaded && (
                <button type="button" onClick={p.onSaveAndNext} disabled={running}
                  className="px-2 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                  {t('proposal.saveAndNext')}
                </button>
              )}
              <button type="button" onClick={p.onReject} disabled={running}
                className="px-2 py-0.5 rounded border border-violet-300 hover:bg-violet-100 disabled:opacity-50">
                {t('proposal.reject')}
              </button>
            </>
          )}
          {p.pack && remaining > 0 && (
            <>
              <button type="button" onClick={p.onAcceptPack} disabled={running}
                className="px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                {t('proposal.acceptPack')}
              </button>
              <button type="button" onClick={p.onRejectPack} disabled={running}
                className="px-2 py-0.5 rounded border border-violet-300 hover:bg-violet-100 disabled:opacity-50">
                {t('proposal.rejectPack')}
              </button>
            </>
          )}
          <button type="button" onClick={p.onHandoff}
            className="px-2 py-0.5 rounded border border-violet-300 hover:bg-violet-100">
            {t('proposal.handoff')}
          </button>
        </div>
      </div>

      {p.pack?.note && <div>{t('proposal.packNote', { note: p.pack.note })}</div>}
      {p.review?.note && <div>{t('proposal.pageNote', { note: p.review.note })}</div>}
      {p.loaded && <div>{t('proposal.loaded')}</div>}
      {p.pendingNotLoaded && (
        <div className="flex items-center gap-2">
          <span>{t('proposal.notLoaded')}</span>
          <button type="button" onClick={p.onLoad} className="px-2 py-0.5 rounded border border-violet-300 hover:bg-violet-100">
            {t('proposal.load')}
          </button>
        </div>
      )}
      {staleDiff && (
        <>
          <div className="text-amber-800">{t('proposal.stale')}</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[11px] text-gray-800">
            {staleDiff.map((o, i) => (
              <span key={i} className={o.op === 'ins' ? 'bg-green-100' : o.op === 'del' ? 'bg-red-100 line-through text-red-700' : ''}>
                {o.text}
              </span>
            ))}
          </pre>
        </>
      )}
      {running && (
        <div className="flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" />
          {t('proposal.jobRunning', { done: p.job?.done ?? 0, total: p.job?.total ?? 0 })}
        </div>
      )}
      {p.job?.state === 'done' && p.job.result && (
        <div>{t('proposal.jobDone', {
          accepted: p.job.result.accepted.length, stale: p.job.result.stale.length, skipped: p.job.result.skipped.length,
        })}</div>
      )}
      {p.job?.state === 'error' && <div className="text-red-700">{t('proposal.jobError', { error: p.job.error })}</div>}
      {p.error && <div className="text-red-700">{t('proposal.error', { error: p.error })}</div>}
      {p.handoff && (
        <div className="flex flex-wrap items-center gap-2">
          <span>{t('proposal.handoffInfo', {
            time: new Date(p.handoff.expires_at * 1000).toLocaleString(), uses: p.handoff.max_uses,
          })}</span>
          <code className="select-all rounded bg-white px-1.5 py-0.5 font-mono">{p.handoff.code}</code>
          <button type="button" className="px-2 py-0.5 rounded border border-violet-300 hover:bg-violet-100"
            onClick={() => { void navigator.clipboard?.writeText(p.handoff!.code); setCopied(true); }}>
            {copied ? '✓' : t('proposal.copy')}
          </button>
        </div>
      )}
    </div>
  );
}
