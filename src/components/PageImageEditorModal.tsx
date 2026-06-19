import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Scissors, RotateCcw, RotateCw, FlipVertical2, Crop, Loader2, AlertTriangle, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FILE_API_URL, IMAGE_BASE_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { transformPageImage, CropRect } from '../services/pageService';
import { expandedBoundingBox } from '../utils/imageTransformGeometry';
import { computeNextAnchor, resolveIndexAfter } from '../utils/pageNavAnchor';
import { resizeRotatedBox, CropHandle, CenterBox } from '../utils/cropBoxInteraction';
import { rotatedCropToServerParams } from '../utils/rotatedCropParams';

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
  const [grossAngle, setGrossAngle] = useState(0);   // jäme orientatsioon (90/180 nupud)
  const [boxAngle, setBoxAngle] = useState(0);        // crop-kasti kalle (deskew)
  const [cropRect, setCropRect] = useState<CropRect | null>(null);  // telg-joondatud kasti-lokaal
  const [splitX, setSplitX] = useState(0.5);

  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);

  // Kärpe-lohistuse ajutine olek (display-pikslites)
  const [cropDraft, setCropDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // Aktiivne interaktsioon: uue joonistamine, liigutamine, sangaga muutmine või pööramine
  const interaction = useRef<
    | { mode: 'draw' }
    | { mode: 'move'; startX: number; startY: number; startCenter: { cx: number; cy: number } }
    | { mode: 'resize'; handle: CropHandle; startBox: CenterBox }
    | { mode: 'rotate' }
    | null
  >(null);
  const draggingSplit = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  const safeIndex = Math.max(0, Math.min(currentIndex, pages.length - 1));
  const current = pages[safeIndex];

  // Pildi vahetusel lähtesta teisendused
  const resetTransforms = useCallback(() => {
    setGrossAngle(0);
    setBoxAngle(0);
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

  // Eelvaate geomeetria: jäme pööre (grossAngle) rakendub PILDILE; kast tilditakse eraldi.
  const natural = imgNatural ?? { w: 4, h: 3 };
  const expanded = expandedBoundingBox(natural.w, natural.h, grossAngle);
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

  // cropRect (normaliseeritud, kasti-lokaal) ↔ kese-põhine display-piksli kast
  const rectToCenterPx = (r: CropRect): CenterBox => ({
    cx: (r.x + r.w / 2) * displayW, cy: (r.y + r.h / 2) * displayH,
    w: r.w * displayW, h: r.h * displayH,
  });
  const centerPxToRect = (b: CenterBox): CropRect => ({
    x: (b.cx - b.w / 2) / displayW, y: (b.cy - b.h / 2) / displayH,
    w: b.w / displayW, h: b.h / displayH,
  });
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const onCropDown = (e: React.MouseEvent) => {
    if (!imgNatural) return;
    e.preventDefault();
    const p = localPoint(e);
    const target = e.target as HTMLElement;
    const handle = target.dataset.handle as CropHandle | undefined;

    if (handle && cropRect) {
      interaction.current = { mode: 'resize', handle, startBox: rectToCenterPx(cropRect) };
    } else if (target.dataset.rotate !== undefined && cropRect) {
      interaction.current = { mode: 'rotate' };
    } else if (target.dataset.cropbox !== undefined && cropRect) {
      const b = rectToCenterPx(cropRect);
      interaction.current = { mode: 'move', startX: p.x, startY: p.y, startCenter: { cx: b.cx, cy: b.cy } };
    } else {
      // Uue kasti joonistus on alati telg-joondatud → nulli kalle
      setBoxAngle(0);
      interaction.current = { mode: 'draw' };
      setCropDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    }
  };

  const onCropMove = (e: React.MouseEvent) => {
    const it = interaction.current;
    if (!it || !cropRect && it.mode !== 'draw') return;
    const p = localPoint(e);
    if (it.mode === 'draw') {
      setCropDraft((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
    } else if (it.mode === 'move' && cropRect) {
      const b = rectToCenterPx(cropRect);
      const cx = clamp(it.startCenter.cx + (p.x - it.startX), 0, displayW);
      const cy = clamp(it.startCenter.cy + (p.y - it.startY), 0, displayH);
      setCropRect(centerPxToRect({ ...b, cx, cy }));
    } else if (it.mode === 'resize') {
      setCropRect(centerPxToRect(resizeRotatedBox(it.startBox, boxAngle, it.handle, p.x, p.y, MIN_DRAG_PX)));
    } else if (it.mode === 'rotate' && cropRect) {
      const b = rectToCenterPx(cropRect);
      // Kalle nii, et lokaal-üles suund osutab kursorile: atan2(dx, -dy)
      const deg = (Math.atan2(p.x - b.cx, b.cy - p.y) * 180) / Math.PI;
      setBoxAngle(deg);
    }
  };

  const onCropUp = () => {
    const it = interaction.current;
    interaction.current = null;
    if (it?.mode === 'draw' && cropDraft) {
      const left = Math.min(cropDraft.x0, cropDraft.x1);
      const top = Math.min(cropDraft.y0, cropDraft.y1);
      const w = Math.abs(cropDraft.x1 - cropDraft.x0);
      const h = Math.abs(cropDraft.y1 - cropDraft.y0);
      setCropDraft(null);
      if (w < MIN_DRAG_PX || h < MIN_DRAG_PX) {
        setCropRect(null);
        return;
      }
      setCropRect({ x: left / displayW, y: top / displayH, w: w / displayW, h: h / displayH });
    }
  };

  // Jäme 90°/180° pööre rakendub PILDILE; kärbe/kalle lähtestatakse (display-raam muutub)
  const rotateBy = (delta: number) => {
    setGrossAngle((a) => ((a + delta) % 360 + 360) % 360);
    setCropRect(null);
    setCropDraft(null);
    setBoxAngle(0);
    interaction.current = null;
  };

  // Kuvatav kärpe-kast: kese, mõõdud, kalle (joonistamise ajal telg-joondatud)
  const cropOverlay: { cx: number; cy: number; w: number; h: number; angle: number } | null = (() => {
    if (cropDraft) {
      return {
        cx: (cropDraft.x0 + cropDraft.x1) / 2,
        cy: (cropDraft.y0 + cropDraft.y1) / 2,
        w: Math.abs(cropDraft.x1 - cropDraft.x0),
        h: Math.abs(cropDraft.y1 - cropDraft.y0),
        angle: 0,
      };
    }
    if (cropRect) {
      const b = rectToCenterPx(cropRect);
      return { cx: b.cx, cy: b.cy, w: b.w, h: b.h, angle: boxAngle };
    }
    return null;
  })();

  // 8 sanga: nurgad + servad. cursor klassiga.
  const CROP_HANDLES: { id: CropHandle; style: React.CSSProperties; cursor: string }[] = [
    { id: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
    { id: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
    { id: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
    { id: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
    { id: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
    { id: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
    { id: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
    { id: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
  ];

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
        // Jäme pööre + kasti-kalle → serveri (angle, telg-joondatud crop)
        let sendAngle = grossAngle;
        let sendCrop: CropRect | null = null;
        if (cropRect) {
          const b = rectToCenterPx(cropRect);
          const params = rotatedCropToServerParams(
            { cx: b.cx, cy: b.cy, w: b.w, h: b.h, angleDeg: boxAngle }, displayW, displayH,
          );
          sendAngle = ((grossAngle + params.angle) % 360 + 360) % 360;
          // Klampi normaliseeritud kärbe [0,1] sisse (kaitse servast väljaulatuva kasti eest)
          const x = clamp(params.crop.x, 0, 1);
          const y = clamp(params.crop.y, 0, 1);
          sendCrop = { x, y, w: clamp(params.crop.w, 0, 1 - x), h: clamp(params.crop.h, 0, 1 - y) };
        }
        const r = await transformPageImage(workId, currentFilename, sendAngle, sendCrop, authToken);
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

  const noEditChange = tab === 'edit' && grossAngle === 0 && cropRect === null;

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
                {cropRect && Math.abs(boxAngle) > 0.05 && (
                  <span className="text-xs text-gray-600 ml-2 tabular-nums">
                    {t('manage.editor.deskew')}: {boxAngle.toFixed(1)}°
                  </span>
                )}
                {cropRect && (
                  <button onClick={() => { setCropRect(null); setBoxAngle(0); }} className="text-xs text-gray-500 underline hover:text-gray-700 ml-2">
                    {t('manage.editor.cropReset')}
                  </button>
                )}
              </div>

              <p className="text-xs text-gray-400">{t('manage.editor.cropHint')}</p>

              {/* Eelvaade: pilt seisab (jäme pööre), kärpe-kasti saab kallutada */}
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
                    transform: `translate(-50%, -50%) rotate(${grossAngle}deg)`,
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
                  {cropOverlay && (
                    <div
                      data-cropbox=""
                      className="absolute border-2 border-indigo-500"
                      style={{
                        left: cropOverlay.cx - cropOverlay.w / 2,
                        top: cropOverlay.cy - cropOverlay.h / 2,
                        width: cropOverlay.w,
                        height: cropOverlay.h,
                        transform: `rotate(${cropOverlay.angle}deg)`,
                        transformOrigin: 'center',
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                        cursor: 'move',
                      }}
                    >
                      {/* Resize-sangad + pöördesang (ainult kinnitatud kastil) */}
                      {!cropDraft && (
                        <>
                          {CROP_HANDLES.map((hh) => (
                            <div
                              key={hh.id}
                              data-handle={hh.id}
                              className="absolute w-2.5 h-2.5 bg-white border border-indigo-600 rounded-sm"
                              style={{ ...hh.style, transform: 'translate(-50%, -50%)', cursor: hh.cursor }}
                            />
                          ))}
                          {/* Pöördesang ülal keskel */}
                          <div
                            className="absolute w-px bg-indigo-500 pointer-events-none"
                            style={{ left: '50%', top: -22, height: 22 }}
                          />
                          <div
                            data-rotate=""
                            title={t('manage.editor.deskew')}
                            className="absolute w-3 h-3 bg-white border border-indigo-600 rounded-full"
                            style={{ left: '50%', top: -22, transform: 'translate(-50%, -50%)', cursor: 'grab' }}
                          />
                        </>
                      )}
                    </div>
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
