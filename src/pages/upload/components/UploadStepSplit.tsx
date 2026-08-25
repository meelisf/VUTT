import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import {
  applyPrepress, getPrepress, savePrepress, setOcrModel, startPrepress,
} from '../uploadApi';
import {
  applyDefaultSplitTo, clearDefaultSplit, countByMode, setExcluded, setNoSplit,
  summarizePlan, willSplit,
} from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';
import SplitActionBar from './SplitActionBar';
import SplitContactSheet from './SplitContactSheet';
import SplitPageDetail from './SplitPageDetail';

const POLL_MS = 1500;
const MIN_COLS = 3;
const MAX_COLS = 10;

interface Props {
  uploadId: string;
  token: string | null;
  onDone: () => void;
}

/**
 * Viisardi 3. samm: lehtede ülevaatus enne OCR-i.
 *
 * Ülevaatus on ALATI nähtav (ADR 0026) — 100 DPI eelvaade renderdatakse iga
 * upload'i puhul. Opt-in-iks jääb ainult KALLIS osa: poolitusteta plaan saadab
 * endiselt originaal-PDF-i, ilma ühegi 300 DPI pikslita.
 *
 * Otsustusloogika elab `prepressPlan.ts`-is; see komponent on raam ja vormindaja.
 */
const UploadStepSplit: React.FC<Props> = ({ uploadId, token, onDone }) => {
  const { t } = useTranslation(['upload', 'common']);
  const [plan, setPlan] = useState<PrepressPlan | null>(null);
  const [detailPage, setDetailPage] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [gridCols, setGridCols] = useState(5);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [barResult, setBarResult] = useState<string | null>(null);
  const lastSelectedRef = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ülevaatus on ALATI nähtav (§1) — eelvaade käivitub ise. startPrepress on
  // idempotentne (preview_status === 'rendering' → tagasi), seega StrictMode'i
  // topeltkutse on ohutu.
  useEffect(() => {
    let cancelled = false;
    startPrepress(uploadId, token)
      .then(() => getPrepress(uploadId, token))
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
        { default_split_x: next.default_split_x, pages: next.pages },
        token,
      ).catch(() => setError(t('errors.networkError')));
    }, 400);
  }, [uploadId, token, t]);

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

  // --- Valik: WorkManage.handleToggle muster ---

  const handleToggleSelect = (n: number, shiftKey: boolean) => {
    const idx = plan ? plan.pages.findIndex((p) => p.n === n) : -1;
    // Loe ankur ENNE setState'i: updater jookseb hiljem, aga ref kirjutatakse
    // üle juba allpool — laisk lugemine kahandaks vahemiku üheks elemendiks.
    const anchor = lastSelectedRef.current;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchor !== null && plan) {
        const [lo, hi] = [anchor, idx].sort((a, b) => a - b);
        for (let i = lo; i <= hi; i++) next.add(plan.pages[i].n);
      } else if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
    lastSelectedRef.current = idx;
  };

  const clearSelection = () => {
    setSelected(new Set());
    lastSelectedRef.current = null;
    setBarResult(null);
  };

  const selectedNs = useMemo(() => Array.from(selected), [selected]);

  // --- Hulgikäsud: üks plaani salvestus, mitte N päringut ---

  const handleSplitAll = () => {
    if (!plan) return;
    const { applied, keptCustom } = countByMode(plan, plan.pages.map((p) => p.n));
    persist(applyDefaultSplitTo(plan));
    setBarResult(keptCustom > 0
      ? t('step3split.bar.splitResult', { applied, kept: keptCustom })
      : null);
  };
  const handleClearGlobalSplit = () => { if (plan) persist(clearDefaultSplit(plan)); };
  const handleBarSplit = () => { if (plan) persist(applyDefaultSplitTo(plan, selectedNs)); };
  const handleBarNoSplit = () => { if (plan) persist(setNoSplit(plan, selectedNs)); };
  const handleBarExclude = () => { if (plan) persist(setExcluded(plan, selectedNs, true)); };
  const handleBarInclude = () => { if (plan) persist(setExcluded(plan, selectedNs, false)); };

  const handleModelChange = async (model: 'print' | 'hand') => {
    if (!plan || plan.ocr_model === model) return;
    setPlan({ ...plan, ocr_model: model });
    try {
      await setOcrModel(uploadId, model, token);
    } catch {
      // 409 = apply on juba alanud; loeme serveri tõe tagasi.
      setError(t('step3split.model.locked'));
      getPrepress(uploadId, token).then(setPlan).catch(() => undefined);
    }
  };

  const handleContinue = async () => {
    setApplying(true);
    setError('');
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (plan) {
        await savePrepress(
          uploadId,
          { default_split_x: plan.default_split_x, pages: plan.pages },
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
  const summaryText = summary.split > 0
    ? t('step3split.summarySplit', {
      split: summary.split, output: summary.output, excluded: summary.excluded,
    })
    : t('step3split.summaryNoSplit', {
      output: summary.output, excluded: summary.excluded,
    });

  const handleSelectAll = () => setSelected(new Set(plan.pages.map((p) => p.n)));
  const handleSelectSplit = () =>
    setSelected(new Set(plan.pages.filter((p) => willSplit(plan, p.n)).map((p) => p.n)));

  // Mitteaktiivne mudelipool peab olema selgelt hämaram — ühe pilguga peab
  // näha olema, kumb kehtib (§3).
  const modelBtn = (active: boolean) =>
    `px-3 py-1 text-sm border ${active
      ? 'bg-primary-600 border-primary-600 text-white font-medium'
      : 'bg-gray-50 border-gray-300 text-gray-400 hover:text-gray-700'}`;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">{t('step3split.title')}</h2>

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

      {/* Päis: mudel · poolitusjoon · üldkäsud */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">{t('step3split.model.label')}</span>
          <div className="inline-flex rounded overflow-hidden">
            <button
              type="button"
              onClick={() => handleModelChange('print')}
              aria-pressed={plan.ocr_model === 'print'}
              className={`${modelBtn(plan.ocr_model === 'print')} rounded-l`}
            >
              {t('step3split.model.print')}
            </button>
            <button
              type="button"
              onClick={() => handleModelChange('hand')}
              aria-pressed={plan.ocr_model === 'hand'}
              className={`${modelBtn(plan.ocr_model === 'hand')} rounded-r border-l-0`}
            >
              {t('step3split.model.hand')}
            </button>
          </div>
        </div>

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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSplitAll}
            className="px-3 py-1 text-sm rounded bg-primary-600 text-white hover:bg-primary-700"
          >
            {t('step3split.splitAll')}
          </button>
          <button
            type="button"
            onClick={handleClearGlobalSplit}
            className="px-3 py-1 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            {t('step3split.clearGlobalSplit')}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        {/* Paneeli päis: valikuabid EI kuulu tegevusribale — nad valivad,
            ei muuda midagi (§10). */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-gray-100">
          <span className="font-semibold text-gray-800">{t('step3split.title')}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="px-2 py-1 text-xs border rounded text-gray-700 hover:bg-gray-50"
            >
              {t('step3split.selectAll')}
            </button>
            <button
              type="button"
              onClick={handleSelectSplit}
              className="px-2 py-1 text-xs border rounded text-gray-700 hover:bg-gray-50"
            >
              {t('step3split.selectSplit')}
            </button>
            <span className="text-sm text-gray-500">{summaryText}</span>
          </div>
        </div>

        {/* Pisipiltide suuruse juhtnupp — all, WorkManage'iga identne */}
        <div className="flex items-center gap-2 px-4 pt-2 text-sm text-gray-600">
          <button
            type="button"
            onClick={() => setGridCols((c) => Math.min(c + 1, MAX_COLS))}
            disabled={gridCols >= MAX_COLS}
            className="px-2 py-0.5 border rounded disabled:opacity-40"
            title={t('step3split.gridSmaller')}
          >−</button>
          <input
            type="range"
            min={MIN_COLS}
            max={MAX_COLS}
            value={MAX_COLS + MIN_COLS - gridCols}
            onChange={(e) => setGridCols(MAX_COLS + MIN_COLS - Number(e.target.value))}
            aria-label={t('step3split.gridColumns')}
          />
          <button
            type="button"
            onClick={() => setGridCols((c) => Math.max(c - 1, MIN_COLS))}
            disabled={gridCols <= MIN_COLS}
            className="px-2 py-0.5 border rounded disabled:opacity-40"
            title={t('step3split.gridLarger')}
          >+</button>
        </div>

        {/* pb-24: viimane rida ei tohi jääda hõljuva riba taha */}
        <div className={selected.size > 0 ? 'pb-24' : ''}>
          <SplitContactSheet
            uploadId={uploadId}
            token={token}
            plan={plan}
            gridCols={gridCols}
            selected={selected}
            onToggleSelect={handleToggleSelect}
            onPageChange={handlePageChange}
            onOpenPage={setDetailPage}
          />
        </div>
      </div>

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

      <SplitActionBar
        selectedCount={selected.size}
        onSplit={handleBarSplit}
        onNoSplit={handleBarNoSplit}
        onExclude={handleBarExclude}
        onInclude={handleBarInclude}
        onClearSelection={clearSelection}
        resultText={barResult}
      />

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
