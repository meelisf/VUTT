import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Scissors, RotateCcw, RotateCw, FlipVertical2, Crop, Loader2, AlertTriangle, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FILE_API_URL, IMAGE_BASE_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { transformPageImage, CropRect } from '../services/pageService';
import { expandedBoundingBox } from '../utils/imageTransformGeometry';
import { computeNextAnchor, resolveIndexAfter } from '../utils/pageNavAnchor';

interface PageInfo {
  filename: string;
  page_num: number;
}

interface Props {
  workId: string;
  pages: PageInfo[];                // järjestatud
  initialIndex: number;
  initialTab: 'edit' | 'split';
  imageToken: { exp: number; sig: string } | null;
  onClose: () => void;
  onPagesChanged: () => Promise<string[]>;  // laeb pages uuesti, tagastab uue failinimede massiivi
}

// Eelvaate maksimaalsed mõõdud (px) — pilt mahutatakse nendesse.
const MAXW = 680;
const MAXH = 540;
const MIN_DRAG_PX = 8;   // alla selle ei registreeri kärbet

const PageImageEditorModal: React.FC<Props> = ({
  workId, pages, initialIndex, initialTab, imageToken, onClose, onPagesChanged,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const { authToken } = useUser();

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [tab, setTab] = useState<'edit' | 'split'>(initialTab);
  const [angle, setAngle] = useState(0);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [splitX, setSplitX] = useState(0.5);

  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);

  // Kärpe-lohistuse ajutine olek (display-pikslites)
  const [cropDraft, setCropDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const draggingCrop = useRef(false);
  const draggingSplit = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  const safeIndex = Math.max(0, Math.min(currentIndex, pages.length - 1));
  const current = pages[safeIndex];

  // Pildi vahetusel lähtesta teisendused
  const resetTransforms = useCallback(() => {
    setAngle(0);
    setCropRect(null);
    setCropDraft(null);
    setSplitX(0.5);
    setImgNatural(null);
    setError(null);
  }, []);

  useEffect(() => {
    resetTransforms();
  }, [current?.filename, resetTransforms]);

  const imageUrl = (() => {
    if (!current) return '';
    const base = `${IMAGE_BASE_URL}/${workId}/${current.filename}`;
    return imageToken ? `${base}?exp=${imageToken.exp}&sig=${imageToken.sig}` : base;
  })();

  // Eelvaate geomeetria (pööratud bounding-box mahutatud MAXW×MAXH-i)
  const natural = imgNatural ?? { w: 4, h: 3 };
  const expanded = expandedBoundingBox(natural.w, natural.h, angle);
  const fit = Math.min(MAXW / expanded.width, MAXH / expanded.height);
  const displayW = expanded.width * fit;
  const displayH = expanded.height * fit;
  const imgDispW = natural.w * fit;
  const imgDispH = natural.h * fit;

  // --- Kärpe-lohistus (edit-tab) ---
  const localPoint = (e: React.MouseEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
    };
  };

  const onCropDown = (e: React.MouseEvent) => {
    if (!imgNatural) return;
    e.preventDefault();
    draggingCrop.current = true;
    const p = localPoint(e);
    setCropDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onCropMove = (e: React.MouseEvent) => {
    if (!draggingCrop.current || !cropDraft) return;
    const p = localPoint(e);
    setCropDraft({ ...cropDraft, x1: p.x, y1: p.y });
  };
  const onCropUp = () => {
    draggingCrop.current = false;
    if (!cropDraft) return;
    const left = Math.min(cropDraft.x0, cropDraft.x1);
    const top = Math.min(cropDraft.y0, cropDraft.y1);
    const w = Math.abs(cropDraft.x1 - cropDraft.x0);
    const h = Math.abs(cropDraft.y1 - cropDraft.y0);
    setCropDraft(null);
    if (w < MIN_DRAG_PX || h < MIN_DRAG_PX) {
      setCropRect(null);
      return;
    }
    // Normaliseeri pööratud-pildi (display-box) koordinaatides
    setCropRect({ x: left / displayW, y: top / displayH, w: w / displayW, h: h / displayH });
  };

  // Pööramisel kärbe ei kehti enam (ristkülik joonistati teise bbox-i kohta)
  const rotateBy = (delta: number) => {
    setAngle((a) => ((a + delta) % 360 + 360) % 360);
    setCropRect(null);
    setCropDraft(null);
  };

  // Kuvatav kärpe-ristkülik (kas lohistuse ajal või kinnitatud)
  const cropOverlayBox = (() => {
    if (cropDraft) {
      return {
        left: Math.min(cropDraft.x0, cropDraft.x1),
        top: Math.min(cropDraft.y0, cropDraft.y1),
        width: Math.abs(cropDraft.x1 - cropDraft.x0),
        height: Math.abs(cropDraft.y1 - cropDraft.y0),
      };
    }
    if (cropRect) {
      return {
        left: cropRect.x * displayW,
        top: cropRect.y * displayH,
        width: cropRect.w * displayW,
        height: cropRect.h * displayH,
      };
    }
    return null;
  })();

  // --- Split-lohistus (split-tab) ---
  const updateSplitX = useCallback((clientX: number) => {
    if (!splitContainerRef.current) return;
    const rect = splitContainerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    setSplitX(Math.max(0.05, Math.min(0.95, x)));
  }, []);

  // --- Navigeerimine ---
  const goTo = useCallback((idx: number) => {
    setCurrentIndex(Math.max(0, Math.min(pages.length - 1, idx)));
    setShowConfirm(false);
    setToast(null);
  }, [pages.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      const role = (document.activeElement as HTMLElement | null)?.getAttribute('role');
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || role === 'slider') return;
      if (e.key === 'ArrowLeft') goTo(currentIndex - 1);
      else if (e.key === 'ArrowRight') goTo(currentIndex + 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentIndex, goTo, onClose]);

  // --- Rakenda ---
  const doApply = async () => {
    if (!authToken || !current) return;
    setShowConfirm(false);
    setSaving(true);
    setError(null);
    setToast(null);

    const before = pages.map((p) => p.filename);
    const anchor = computeNextAnchor(before, current.filename);
    const currentFilename = current.filename;

    try {
      let thumbWarn = false;
      if (tab === 'edit') {
        const r = await transformPageImage(workId, currentFilename, angle, cropRect, authToken);
        thumbWarn = !!r.thumbnail_warning;
      } else {
        const res = await fetchWithTimeout(
          `${FILE_API_URL}/admin/work/${workId}/page/${current.page_num}/split`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
            body: JSON.stringify({ split_x: splitX }),
            timeout: 30000,
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }
      }

      const after = await onPagesChanged();
      const { index, done } = resolveIndexAfter(after, anchor, currentFilename);
      setCurrentIndex(index);
      setSaving(false);

      if (tab === 'split') {
        // Uued pooled = failid, mida enne polnud
        const newHalves = after.filter((f) => !before.includes(f));
        const firstHalfIdx = newHalves.length > 0 ? after.indexOf(newHalves[0]) : -1;
        setToast({
          text: t('manage.editor.splitDone'),
          action: firstHalfIdx >= 0
            ? { label: t('manage.editor.viewNewHalves'), run: () => goTo(firstHalfIdx) }
            : undefined,
        });
      } else if (done) {
        setToast({ text: t('manage.editor.allDone') });
      } else if (thumbWarn) {
        setToast({ text: t('manage.editor.thumbWarning') });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('manage.editor.applyError'));
      setSaving(false);
    }
  };

  const onApplyClick = () => {
    if (skipConfirm) {
      doApply();
    } else {
      setShowConfirm(true);
    }
  };

  if (!current) return null;

  const noEditChange = tab === 'edit' && angle === 0 && cropRect === null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]">

        {/* Päis */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Crop size={18} className="text-indigo-600" />
            <h2 className="font-semibold text-gray-900">{t('manage.editor.title')}</h2>
            <span className="text-sm text-gray-400">
              {t('manage.editor.page', { cur: safeIndex + 1, total: pages.length })}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label={t('manage.editor.close')}>
            <X size={20} />
          </button>
        </div>

        {/* Tabid */}
        <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
          <button
            onClick={() => { setTab('edit'); setError(null); }}
            className={`px-3 py-1.5 text-sm rounded-t-md border-b-2 transition-colors ${tab === 'edit' ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t('manage.editor.tabEdit')}
          </button>
          <button
            onClick={() => { setTab('split'); setError(null); }}
            className={`px-3 py-1.5 text-sm rounded-t-md border-b-2 transition-colors ${tab === 'split' ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t('manage.editor.tabSplit')}
          </button>
        </div>

        {/* Sisu */}
        <div className="flex-1 overflow-auto p-4 bg-gray-50">
          {tab === 'edit' ? (
            <div className="flex flex-col items-center gap-4">
              {/* Tööriistad */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button onClick={() => rotateBy(-90)} title={t('manage.editor.rotateLeft')} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100">
                  <RotateCcw size={16} />
                </button>
                <button onClick={() => rotateBy(90)} title={t('manage.editor.rotateRight')} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100">
                  <RotateCw size={16} />
                </button>
                <button onClick={() => rotateBy(180)} title={t('manage.editor.rotate180')} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100">
                  <FlipVertical2 size={16} />
                </button>
                <div className="flex items-center gap-2 ml-2">
                  <label className="text-xs text-gray-500">{t('manage.editor.deskew')}</label>
                  <input
                    type="range" min={-10} max={10} step={0.1} value={angle > 180 ? angle - 360 : angle}
                    onChange={(e) => { setAngle(parseFloat(e.target.value)); setCropRect(null); setCropDraft(null); }}
                    className="w-40"
                  />
                  <span className="text-xs text-gray-600 w-10 tabular-nums">{(angle > 180 ? angle - 360 : angle).toFixed(1)}°</span>
                </div>
                {cropRect && (
                  <button onClick={() => setCropRect(null)} className="text-xs text-gray-500 underline hover:text-gray-700 ml-2">
                    {t('manage.editor.cropReset')}
                  </button>
                )}
              </div>

              <p className="text-xs text-gray-400">{t('manage.editor.cropHint')}</p>

              {/* Eelvaade pööratud bounding-box'iga */}
              <div
                className="relative bg-white shadow-inner border border-gray-200"
                style={{ width: displayW || MAXW, height: displayH || MAXH }}
              >
                <img
                  src={imageUrl}
                  alt={current.filename}
                  draggable={false}
                  onLoad={(e) => setImgNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  className="absolute pointer-events-none select-none"
                  style={{
                    width: imgDispW || undefined,
                    height: imgDispH || undefined,
                    left: '50%', top: '50%',
                    transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                  }}
                />
                {/* Kärpe-overlay (püüab hiire) */}
                <div
                  ref={overlayRef}
                  className="absolute inset-0 cursor-crosshair"
                  onMouseDown={onCropDown}
                  onMouseMove={onCropMove}
                  onMouseUp={onCropUp}
                  onMouseLeave={onCropUp}
                >
                  {cropOverlayBox && (
                    <>
                      <div className="absolute inset-0 bg-black/30 pointer-events-none" />
                      <div
                        className="absolute border-2 border-indigo-500 bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.0)] pointer-events-none"
                        style={{
                          left: cropOverlayBox.left, top: cropOverlayBox.top,
                          width: cropOverlayBox.width, height: cropOverlayBox.height,
                          boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-500 mb-3">
                {t('manage.editor.tabSplit')} — <span className="font-medium text-gray-700">{Math.round(splitX * 100)}%</span>
              </p>
              <div
                ref={splitContainerRef}
                className="relative select-none cursor-col-resize overflow-hidden rounded border border-gray-200 mx-auto"
                style={{ maxWidth: MAXW }}
                onMouseMove={(e) => { if (draggingSplit.current) updateSplitX(e.clientX); }}
                onMouseUp={() => { draggingSplit.current = false; }}
                onMouseLeave={() => { draggingSplit.current = false; }}
              >
                <img
                  src={imageUrl}
                  alt={current.filename}
                  className="w-full h-auto block pointer-events-none"
                  draggable={false}
                  onLoad={(e) => setImgNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
                <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-90 pointer-events-none" style={{ left: `${splitX * 100}%` }} />
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 bg-red-500 rounded cursor-col-resize flex items-center justify-center shadow-md"
                  style={{ left: `${splitX * 100}%` }}
                  onMouseDown={(e) => { e.preventDefault(); draggingSplit.current = true; }}
                >
                  <div className="w-0.5 h-6 bg-white/70 mx-0.5" />
                  <div className="w-0.5 h-6 bg-white/70 mx-0.5" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Jalus */}
        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 space-y-3">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          {toast && (
            <div className="flex items-center justify-between gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800">
              <span className="flex items-center gap-2"><Check size={14} /> {toast.text}</span>
              {toast.action && (
                <button onClick={toast.action.run} className="text-emerald-700 underline hover:text-emerald-900 font-medium">
                  {toast.action.label}
                </button>
              )}
            </div>
          )}

          {showConfirm && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
              <p className="text-sm text-amber-800">{t('manage.editor.confirmBody')}</p>
              <label className="flex items-center gap-2 text-sm text-amber-700">
                <input type="checkbox" checked={skipConfirm} onChange={(e) => setSkipConfirm(e.target.checked)} />
                {t('manage.editor.dontAskAgain')}
              </label>
            </div>
          )}

          <div className="flex items-center justify-between">
            {/* Navigeerimine */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => goTo(currentIndex - 1)}
                disabled={safeIndex <= 0 || saving}
                title={t('manage.editor.prev')}
                className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => goTo(currentIndex + 1)}
                disabled={safeIndex >= pages.length - 1 || saving}
                title={t('manage.editor.next')}
                className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Rakenda */}
            <button
              onClick={showConfirm ? doApply : onApplyClick}
              disabled={saving || (tab === 'edit' && noEditChange)}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : (tab === 'split' ? <Scissors size={14} /> : <Check size={14} />)}
              {t('manage.editor.apply')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PageImageEditorModal;
