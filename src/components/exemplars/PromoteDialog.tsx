/**
 * „Tee transkriptsiooni aluseks" (ADR 0089 p 6): eksemplari pildid → asendusrežiimis
 * üleslaadimine. `mode="confirm"`: viisardi asenduse 409 järel uus kinnitus sama
 * üleslaadimise juures (värske eelvaade tuleb vastusest).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useNotify } from '../../contexts/FeedbackContext';
import { ApiError, apiErrorMessage } from '../../services/apiClient';
import {
  PROMOTE_RECONFIRM_CODES, confirmPromote, fetchPromotePreview, startPromote, type PromotePreview,
} from '../../services/promoteApi';

export interface PromoteExemplar { id: string; holder?: string | null; shelfmark?: string | null }

interface PromoteDialogProps {
  workId: string;
  exemplarId: string;
  exemplars: PromoteExemplar[];
  authToken: string | null;
  mode: 'start' | 'confirm';
  uploadId?: string;
  initialPreview?: PromotePreview;
  onClose: () => void;
  onStarted?: (uploadId: string) => void;
  onConfirmed?: () => void;
}

/** 409 vastusest värske eelvaade, kui sellele saab uue kinnitusega vastata. */
export function reconfirmPreview(e: unknown): PromotePreview | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const d = (e.data as { detail?: { code?: string; detail?: unknown } } | null)?.detail;
  if (!d || !(PROMOTE_RECONFIRM_CODES as readonly string[]).includes(d.code ?? '')) return null;
  const pv = d.detail as PromotePreview | undefined;
  return pv && Array.isArray(pv.pages) ? pv : null;
}

const PromoteDialog: React.FC<PromoteDialogProps> = ({
  workId, exemplarId, exemplars, authToken, mode, uploadId, initialPreview, onClose, onStarted, onConfirmed,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const notify = useNotify();
  const [preview, setPreview] = useState<PromotePreview | null>(initialPreview ?? null);
  const [target, setTarget] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialPreview) return;
    let cancelled = false;
    fetchPromotePreview(workId, exemplarId, authToken)
      .then(pv => { if (!cancelled) setPreview(pv); })
      .catch(e => { if (!cancelled) { notify(apiErrorMessage(e, t('exemplarPage.promote.failed')), 'error'); onClose(); } });
    return () => { cancelled = true; };
    // Eelvaade laetakse üks kord dialoogi avamisel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, exemplarId]);

  const label = (id: string | null) => {
    const x = exemplars.find(e => e.id === id);
    return x ? [x.holder, x.shelfmark].filter(Boolean).join(' · ') || x.id : (id ?? '');
  };
  const editedCount = preview ? Object.keys(preview.edited).length : 0;
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of preview?.pages ?? []) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return [...m.entries()];
  }, [preview]);
  const originCounts = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const p of preview?.pages ?? []) m.set(p.origin, (m.get(p.origin) ?? 0) + 1);
    return [...m.entries()];
  }, [preview]);

  const needTarget = !!preview && preview.unknown.length > 0;
  const disabled = busy || !preview || preview.unstorable.length > 0
    || (needTarget && !target) || (editedCount > 0 && !ack);

  async function submit() {
    if (!preview) return;
    const body = { unknown_target: needTarget ? target : null, confirmed_edited: preview.edited };
    setBusy(true);
    try {
      if (mode === 'start') {
        const id = await startPromote(workId, exemplarId, body, authToken);
        onStarted?.(id);
      } else if (uploadId) {
        await confirmPromote(uploadId, body, authToken);
        onConfirmed?.();
      }
    } catch (e) {
      const uus = reconfirmPreview(e);
      if (uus) {
        setPreview(uus);
        setAck(false);
        notify(t('exemplarPage.promote.changed'), 'warning');
      } else {
        notify(apiErrorMessage(e, t('exemplarPage.promote.failed')), 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1300] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center">
          <h2 className="font-semibold text-gray-900">{t('exemplarPage.promote.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common:buttons.close')} className="ml-auto p-1 rounded hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        {!preview ? (
          <p className="text-sm text-gray-500">{t('common:labels.loading')}</p>
        ) : (
          <>
            <p className="text-sm text-gray-700">
              {t('exemplarPage.promote.summary', { images: preview.images, pages: preview.pages.length, target: label(exemplarId) })}
            </p>
            <p className="text-xs text-gray-500">
              {statusCounts.map(([s, n]) => `${t(`common:status.${s}`, s)}: ${n}`).join(' · ')}
            </p>
            <div className="text-sm">
              <p className="text-gray-700">{t('exemplarPage.promote.oldPagesTo')}</p>
              <ul className="list-disc pl-5 text-gray-600">
                {originCounts.map(([o, n]) => (
                  <li key={o ?? '?'}>{o ? label(o) : t('exemplarPage.promote.unknownOrigin')}: {n}</li>
                ))}
              </ul>
            </div>
            {needTarget && (
              <label className="block text-sm">
                <span className="text-gray-700">{t('exemplarPage.promote.unknownTarget')}</span>
                <select aria-label={t('exemplarPage.promote.unknownTarget')} value={target}
                  onChange={e => setTarget(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                  <option value="">—</option>
                  {exemplars.filter(x => x.id !== exemplarId).map(x => (
                    <option key={x.id} value={x.id}>{label(x.id)}</option>
                  ))}
                </select>
              </label>
            )}
            {preview.parts > 0 && (
              <p className="text-sm text-amber-700">{t('exemplarPage.promote.partsWarning', { count: preview.parts })}</p>
            )}
            {preview.unstorable.length > 0 && (
              <div className="text-sm text-red-700">
                <p>{t('exemplarPage.promote.unstorable')}</p>
                <ul className="list-disc pl-5">
                  {preview.unstorable.map(u => <li key={u.stem}>{u.stem}: {u.reason}</li>)}
                </ul>
              </div>
            )}
            {editedCount > 0 && (
              <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-2">
                <p>{t('exemplarPage.promote.editedWarning', { count: editedCount })}</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                  {t('exemplarPage.promote.editedAck')}
                </label>
              </div>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50">
            {t('common:buttons.close')}
          </button>
          <button type="button" onClick={submit} disabled={disabled}
            className="px-3 py-1.5 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
            {mode === 'start' ? t('exemplarPage.promote.start') : t('exemplarPage.promote.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromoteDialog;
