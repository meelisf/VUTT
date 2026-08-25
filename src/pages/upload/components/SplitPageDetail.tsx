import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight, Columns2, Eye, EyeOff, LayoutGrid } from 'lucide-react';
import { prepressPreviewUrl } from '../uploadApi';
import { clampSplitX, willSplit } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';

interface Props {
  uploadId: string;
  token: string | null;
  plan: PrepressPlan;
  pageNum: number;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onNavigate: (n: number) => void;
  onClose: () => void;
}

/**
 * Teine tase: üks leht suurelt, lohistatava joonega.
 *
 * Natiivse lahutusega köitevahe-riba oli siin varem kõrval-paanina ja
 * eemaldati: 100 DPI eelvaade näitab joone asukoha juba piisava täpsusega,
 * riba aga tõi kaasa oma endpointi, x-kvantimise ja ketta-vahemälu.
 *
 * Joon ja käepide järgivad TAHTLIKULT sama kuju nagu Manage-lehe poolitamine
 * (`PageImageEditorModal`) — sama žest peab mõlemas kohas ühtemoodi välja
 * nägema ja käituma, sh lohistuse kuulamine aknast (kursor tohib pildilt välja).
 */
const SplitPageDetail: React.FC<Props> = ({
  uploadId, token, plan, pageNum, onPageChange, onNavigate, onClose,
}) => {
  const { t } = useTranslation(['upload', 'common']);
  const page = plan.pages.find((p) => p.n === pageNum);
  const liveX = page?.mode === 'custom' && page.split_x != null
    ? page.split_x
    : plan.default_split_x;

  const [dragging, setDragging] = useState(false);
  const imageRef = useRef<HTMLDivElement>(null);

  // Kas seda lehte päriselt poolitatakse. Joon ja käepide EI TOHI olla nähtaval,
  // kui vastus on ei — muidu näitab vaade tegevust, mida ei toimu.
  const splits = page ? willSplit(plan, pageNum) : false;
  const excluded = Boolean(page?.excluded);
  const noSplitMode = page?.mode === 'nosplit';

  const index = plan.pages.findIndex((p) => p.n === pageNum);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < plan.pages.length - 1;

  const goTo = useCallback((i: number) => {
    const target = plan.pages[i];
    if (target) onNavigate(target.n);
  }, [plan.pages, onNavigate]);

  const setX = (x: number) =>
    onPageChange(pageNum, { mode: 'custom', split_x: clampSplitX(Number(x.toFixed(4))) });

  // Ref hoiab värskeimat setX-i, et aknakuulajad ei tellitaks iga renderi peale
  // uuesti (onPageChange on vanemas inline-arrow).
  const setXRef = useRef(setX);
  setXRef.current = setX;

  const xFromClient = (clientX: number) => {
    const el = imageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setXRef.current((clientX - rect.left) / rect.width);
  };

  // Lohistus: kuula AKNAST, et kursor võiks väljuda pildi raamist
  // (sama muster nagu PageImageEditorModal).
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => xFromClient(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging]);

  // Klaviatuur: nooled vahetavad LEHTE (mitte joont), Escape sulgeb.
  // Sama leping nagu Manage-lehe pildiredaktoris — ära kaaperda nooli,
  // kui fookus on sisestusväljal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      const role = (document.activeElement as HTMLElement | null)?.getAttribute('role');
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || role === 'slider') return;
      if (e.key === 'ArrowLeft') goTo(index - 1);
      else if (e.key === 'ArrowRight') goTo(index + 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, onClose]);

  if (!page) return null;

  return (
    // z-[1300]: Header on `sticky z-[1200]` ja kataks muidu modaali ülemise
    // serva — just seal, kus on sulgemisnupp. Sama väärtus nagu
    // PageImageEditorModal'is; tegevusribad on `z-[1100]` ehk päise all.
    <div className="fixed inset-0 z-[1300] flex items-start justify-center overflow-y-auto bg-black/70 p-2 sm:p-4">
      {/* flex-col + max-h: päis on omaette flex-laps ja EI keri kaasa —
          varem oli päis kerimiskonteineri sees ja kadus väikesel ekraanil
          ülemise serva taha. */}
      <div className="my-auto flex max-h-[calc(100vh-1rem)] w-full max-w-6xl flex-col rounded bg-white sm:max-h-[calc(100vh-2rem)]">
        <div className="flex flex-shrink-0 items-center justify-between gap-2 rounded-t border-b border-gray-200 bg-white px-4 py-3">
          <h3 className="font-semibold">
            {splits
              ? t('step3split.detail.header', {
                n: pageNum,
                total: plan.pages.length,
                percent: Math.round(liveX * 1000) / 10,
              })
              : t('step3split.detail.headerNoSplit', {
                n: pageNum, total: plan.pages.length,
              })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common:buttons.close')}
            className="-mr-1 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mx-auto max-w-3xl">
            <div
              ref={imageRef}
              className={`relative select-none touch-none ${splits ? 'cursor-col-resize' : ''}`}
              onPointerDown={(e) => { if (splits) xFromClient(e.clientX); }}
            >
              <img
                src={prepressPreviewUrl(uploadId, pageNum, token)}
                alt={`${pageNum}`}
                className="block w-full"
                draggable={false}
              />
              {/* Joon + käepide: sama kuju nagu Manage-lehe poolitamisel.
                  Nähtaval AINULT siis, kui leht päriselt poolitatakse. */}
              {splits && (
                <>
                  <div
                    data-testid="detail-line"
                    className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-90"
                    style={{ left: `${liveX * 100}%` }}
                  />
                  <div
                    data-testid="detail-handle"
                    className="absolute top-1/2 flex h-10 w-5 -translate-x-1/2 -translate-y-1/2 cursor-col-resize items-center justify-center rounded bg-red-500 shadow-md"
                    style={{ left: `${liveX * 100}%` }}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
                  >
                    <div className="mx-0.5 h-6 w-0.5 bg-white/70" />
                    <div className="mx-0.5 h-6 w-0.5 bg-white/70" />
                  </div>
                </>
              )}

              {!splits && (
                <div
                  data-testid="detail-nosplit-badge"
                  className="pointer-events-none absolute inset-0 flex items-start justify-center bg-white/40 pt-6"
                >
                  <span className="flex items-center gap-2 rounded-full bg-gray-900/85 px-4 py-2 text-sm font-medium text-white shadow-lg">
                    {excluded ? <EyeOff size={15} /> : <Columns2 size={15} />}
                    {excluded ? t('step3split.isExcluded') : t('step3split.willNotSplit')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 rounded-b border-t border-gray-200 bg-white px-4 py-3">
          {/* Üks rühm, järjestuses: Ülevaatesse | ‹ › | Ära poolita · Ära OCR-i
              · Lähtesta üldjoonele (§9). Väljapääs on SÕNADEGA — päise X ja
              Escape üksi ei ütle, KUHU nad viivad. Lehe vahetus järgib Manage
              pildiredaktori kuju ja klahve; joont nihutab kasutaja AINULT
              hiirega (käepide või klõps pildil). */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                data-testid="back-to-overview"
                onClick={onClose}
                className="mr-2 flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-100"
              >
                <LayoutGrid size={15} />
                {t('step3split.backToOverview')}
              </button>
              <button
                type="button"
                data-testid="page-prev"
                onClick={() => goTo(index - 1)}
                disabled={!hasPrev}
                title={t('common:buttons.previous')}
                className="rounded border border-gray-300 bg-white p-2 hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                data-testid="page-next"
                onClick={() => goTo(index + 1)}
                disabled={!hasNext}
                title={t('common:buttons.next')}
                className="rounded border border-gray-300 bg-white p-2 hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Toggle: silt pöördub oleku järgi, olekut kannab aria-pressed (§8) */}
              <button
                type="button"
                data-testid="detail-nosplit"
                aria-pressed={!noSplitMode}
                className={`flex items-center gap-1.5 rounded border px-3 py-1 text-sm ${
                  !noSplitMode
                    ? 'border-gray-900 bg-gray-900 font-medium text-white'
                    : 'border-gray-300'
                }`}
                onClick={() => onPageChange(pageNum, {
                  mode: noSplitMode ? 'default' : 'nosplit', split_x: null,
                })}
              >
                <Columns2 size={15} />
                {noSplitMode ? t('step3split.card.split') : t('step3split.card.noSplit')}
              </button>
              <button
                type="button"
                data-testid="detail-exclude"
                aria-pressed={excluded}
                className={`flex items-center gap-1.5 rounded border px-3 py-1 text-sm ${
                  excluded
                    ? 'border-gray-900 bg-gray-900 font-medium text-white'
                    : 'border-gray-300'
                }`}
                onClick={() => onPageChange(pageNum, { excluded: !excluded })}
              >
                {excluded ? <EyeOff size={15} /> : <Eye size={15} />}
                {excluded ? t('step3split.card.include') : t('step3split.card.exclude')}
              </button>
              <button
                type="button"
                className={`rounded border px-3 py-1 text-sm ${
                  page.mode === 'default'
                    ? 'border-primary-600 bg-primary-50 font-medium text-primary-700'
                    : 'border-gray-300'
                }`}
                onClick={() => onPageChange(pageNum, { mode: 'default', split_x: null })}
              >
                {t('step3split.detail.resetToGlobal')}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">{t('step3split.detail.arrowHint')}</p>
        </div>
      </div>
    </div>
  );
};

export default SplitPageDetail;
