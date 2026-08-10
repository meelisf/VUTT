import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import {
  applyPrepress, getPrepress, savePrepress, startPrepress,
} from '../uploadApi';
import { summarizePlan } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';
import SplitContactSheet from './SplitContactSheet';
import SplitPageDetail from './SplitPageDetail';

const POLL_MS = 1500;

interface Props {
  uploadId: string;
  token: string | null;
  onDone: () => void;
}

/**
 * Viisardi 3. samm: topeltlehtede poolitamine enne OCR-i.
 *
 * Kogu prepress on OPT-IN. Kuni lülitit ei puututa, ei renderdata ühtki
 * pikslit ja "Edasi" käitub täpselt nagu enne selle featuuri lisamist.
 */
const UploadStepSplit: React.FC<Props> = ({ uploadId, token, onDone }) => {
  const { t } = useTranslation(['upload', 'common']);
  const [plan, setPlan] = useState<PrepressPlan | null>(null);
  const [detailPage, setDetailPage] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPrepress(uploadId, token)
      .then((p) => { if (!cancelled) setPlan(p); })
      .catch(() => { if (!cancelled) setError(t('step3split.renderError')); });
    return () => { cancelled = true; };
  }, [uploadId, token, t]);

  // Eelvaate edenemise polling — ainult renderdamise ajal.
  useEffect(() => {
    if (plan?.preview_status !== 'rendering') return;
    const id = setInterval(() => {
      getPrepress(uploadId, token).then(setPlan).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [plan?.preview_status, uploadId, token]);

  /** Salvestab plaani debounce'itult — joone nihutamine ei tohi POST-e tulistada. */
  const persist = useCallback((next: PrepressPlan) => {
    setPlan(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savePrepress(
        uploadId,
        { enabled: next.enabled, default_split_x: next.default_split_x, pages: next.pages },
        token,
      ).catch(() => setError(t('errors.networkError')));
    }, 400);
  }, [uploadId, token, t]);

  const handleOptIn = async () => {
    if (!plan) return;
    persist({ ...plan, enabled: true });
    try {
      await startPrepress(uploadId, token);
      setPlan(await getPrepress(uploadId, token));
    } catch {
      setError(t('step3split.renderError'));
    }
  };

  const handlePageChange = (n: number, patch: Partial<PrepressPage>) => {
    if (!plan) return;
    persist({
      ...plan,
      pages: plan.pages.map((p) => (p.n === n ? { ...p, ...patch } : p)),
    });
  };

  const handleGlobalLine = (percent: string) => {
    if (!plan) return;
    const value = Number(percent);
    if (!Number.isFinite(value) || value <= 0 || value >= 100) return;
    persist({ ...plan, default_split_x: value / 100 });
  };

  const handleContinue = async () => {
    setApplying(true);
    setError('');
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (plan?.enabled) {
        await savePrepress(
          uploadId,
          { enabled: plan.enabled, default_split_x: plan.default_split_x, pages: plan.pages },
          token,
        );
      }
      await applyPrepress(uploadId, token);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.networkError'));
      setApplying(false);
    }
  };

  if (!plan) return <div className="py-12 text-center text-gray-500">…</div>;

  const summary = summarizePlan(plan);
  const rendering = plan.preview_status === 'rendering';

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">{t('step3split.title')}</h2>

      <label className="flex items-start gap-3 p-4 mb-6 rounded border border-gray-200 bg-gray-50">
        <input
          type="checkbox"
          className="mt-1"
          checked={plan.enabled}
          onChange={(e) => (e.target.checked
            ? handleOptIn()
            : persist({ ...plan, enabled: false }))}
        />
        <span>
          <span className="font-medium block">{t('step3split.optIn')}</span>
          <span className="text-sm text-gray-600 block">{t('step3split.optInHint')}</span>
          <span className="text-sm text-gray-600 block mt-1">{t('step3split.optInHintModel')}</span>
        </span>
      </label>

      {plan.enabled && (
        <>
          {rendering && (
            <div className="mb-4 text-sm text-gray-600">
              {t('step3split.rendering', {
                done: plan.preview_done, total: plan.page_count,
              })}
            </div>
          )}
          {plan.preview_status === 'error' && (
            <div className="mb-4 flex items-center gap-2 text-sm text-red-700">
              <AlertTriangle size={16} />{t('step3split.renderError')}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm">
              {t('step3split.globalLine')}
              <input
                type="text"
                inputMode="numeric"
                className="w-20 px-2 py-1 border rounded"
                value={Math.round(plan.default_split_x * 1000) / 10}
                onChange={(e) => handleGlobalLine(e.target.value)}
              />
            </label>
          </div>

          <p className="mb-4 text-sm text-gray-700">
            {t('step3split.summary', {
              pages: plan.page_count,
              split: summary.split,
              excluded: summary.excluded,
              output: summary.output,
            })}
          </p>

          <SplitContactSheet
            uploadId={uploadId}
            token={token}
            plan={plan}
            onPageChange={handlePageChange}
            onOpenPage={setDetailPage}
          />
        </>
      )}

      {error && <div className="mt-4 text-sm text-red-700">{error}</div>}

      <div className="mt-8">
        <button
          type="button"
          className="px-5 py-2 rounded bg-primary-600 text-white disabled:opacity-50"
          disabled={applying}
          onClick={handleContinue}
        >
          {applying ? t('step3split.applying') : t('step3split.continue')}
        </button>
      </div>

      {detailPage !== null && (
        <SplitPageDetail
          uploadId={uploadId}
          token={token}
          plan={plan}
          pageNum={detailPage}
          onPageChange={handlePageChange}
          onNavigate={setDetailPage}
          onClose={() => setDetailPage(null)}
        />
      )}
    </div>
  );
};

export default UploadStepSplit;
