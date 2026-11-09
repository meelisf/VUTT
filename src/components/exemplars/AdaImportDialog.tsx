import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useNotify } from '../../contexts/FeedbackContext';
import { ApiError, apiErrorMessage } from '../../services/apiClient';
import { fetchAdaImportStatus, startAdaImport, type AdaImportStatus } from '../../services/exemplarImagesService';
import { pollUntil } from '../../hooks/useJobPoll';

interface AdaImportDialogProps {
  workId: string;
  exemplarId: string;
  authToken: string | null;
  onPublished: () => void;
  onClose: () => void;
  /** Testides lühem. */
  pollMs?: number;
}

const RUNNING = new Set(['fetching', 'rendering', 'publishing']);

const parsePage = (s: string): number | undefined => {
  const n = Number.parseInt(s.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** ADA kirje → eksemplari pildid (ADR 0079). Taustatöö; dialoog pollib olekut. */
const AdaImportDialog: React.FC<AdaImportDialogProps> = ({
  workId, exemplarId, authToken, onPublished, onClose, pollMs = 2000,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const notify = useNotify();
  const [handle, setHandle] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<AdaImportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const start = async () => {
    setBusy(true);
    try {
      const { import_id } = await startAdaImport(workId, exemplarId, handle.trim(), parsePage(from), parsePage(to), authToken);
      const res = await pollUntil<AdaImportStatus>({
        request: () => fetchAdaImportStatus(workId, exemplarId, import_id, authToken),
        isRunning: s => RUNNING.has(s.state) && !(s.state === 'publishing' && s.error),
        onStatus: setStatus,
        intervalMs: pollMs,
        alive: () => alive.current,
      });
      if (res.kind === 'cancelled') return;
      if (res.kind === 'failed') {
        notify(apiErrorMessage(res.error, t('exemplarImages.ada.error')), 'error');
      } else if (res.status.state === 'published') {
        notify(t('exemplarImages.ada.published'), 'success');
        onPublished();
      } else {
        notify(res.status.error || t('exemplarImages.ada.error'), 'error');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) notify(t('exemplarImages.ada.already'), 'warning');
      else notify(apiErrorMessage(e, t('exemplarImages.ada.error')), 'error');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const field = 'w-full border border-gray-300 rounded px-2 py-1 text-sm';
  return (
    <div className="fixed inset-0 z-[1300] bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center">
          <h2 className="font-semibold text-gray-900">{t('exemplarImages.ada.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common:buttons.close')} className="ml-auto p-1 rounded hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <label className="block text-sm">
          <span className="text-gray-700">{t('exemplarImages.ada.handle')}</span>
          <input aria-label={t('exemplarImages.ada.handle')} value={handle} onChange={e => setHandle(e.target.value)}
            placeholder="10062/14332" className={field} disabled={busy} />
        </label>
        <div className="flex gap-3">
          <label className="block text-sm flex-1">
            <span className="text-gray-700">{t('exemplarImages.ada.from')}</span>
            <input aria-label={t('exemplarImages.ada.from')} type="text" inputMode="numeric" value={from}
              onChange={e => setFrom(e.target.value)} className={field} disabled={busy} />
          </label>
          <label className="block text-sm flex-1">
            <span className="text-gray-700">{t('exemplarImages.ada.to')}</span>
            <input aria-label={t('exemplarImages.ada.to')} type="text" inputMode="numeric" value={to}
              onChange={e => setTo(e.target.value)} className={field} disabled={busy} />
          </label>
        </div>
        <p className="text-xs text-gray-500">{t('exemplarImages.ada.rangeHint')}</p>
        {busy && status && (
          <p className="text-sm text-gray-700">
            {t(`exemplarImages.ada.state.${status.state}`)}
            {status.pages_total ? ` ${t('exemplarImages.ada.progress', { done: status.pages_done ?? 0, total: status.pages_total })}` : ''}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50">
            {t('common:buttons.close')}
          </button>
          <button type="button" onClick={start} disabled={busy || !handle.trim()}
            className="px-3 py-1.5 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
            {t('exemplarImages.ada.start')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdaImportDialog;
