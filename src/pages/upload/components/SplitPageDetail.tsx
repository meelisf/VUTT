import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight, Ban, EyeOff } from 'lucide-react';
import { prepressPreviewUrl, prepressStripUrl } from '../uploadApi';
import { clampSplitX, willSplit } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';

const STRIP_DEBOUNCE_MS = 400;

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
 * Kolmas tase: üks leht suurelt, lohistatava joonega. Kõrval natiivse
 * lahutusega riba, mille päringut debounce'itakse — lohistamine ei tohi
 * tulistada iga pointermove'i peale uut 300 DPI renderdust.
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

  const [stripX, setStripX] = useState(liveX);
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

  // Debounce: riba päritakse alles pärast pausi. pageNum on sõltuvuses, et
  // lehe vahetusel ei jääks riba vana lehe x-i taha rippuma.
  useEffect(() => {
    const id = setTimeout(() => setStripX(liveX), STRIP_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [liveX, pageNum]);

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
            {pageNum}
            <span className="ml-1 text-sm font-normal text-gray-400">
              / {plan.pages.length}
            </span>
            <span className="ml-3 text-sm font-normal text-gray-500">
              {splits ? `${Math.round(liveX * 1000) / 10}%` : '—'}
            </span>
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
          <div className="flex flex-col gap-4 md:flex-row">
            <div
              ref={imageRef}
              className={`relative flex-1 select-none touch-none ${splits ? 'cursor-col-resize' : ''}`}
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
                    {excluded ? <EyeOff size={15} /> : <Ban size={15} />}
                    {excluded ? t('step3split.isExcluded') : t('step3split.willNotSplit')}
                  </span>
                </div>
              )}
            </div>

            {/* Piksli-tõe paan: object-none + object-center näitab riba TÄPSELT
                1:1, keskele joone peale kärbituna. `w-auto` + fikseeritud kõrgus
                skaleeriks 224 px laia riba ~53 px-le ja kogu natiivse lahutuse
                mõte kaoks (sel põhjusel kadus eraldi ribavaade).

                Pesa hoiab mõõdud ka siis, kui lõiget ei tehta — kui element
                kaoks, laieneks pildiveerg ja vaade hüppaks lehti sirvides. */}
            <div className="flex-none self-center md:self-start">
              {splits ? (
                <img
                  data-testid="detail-strip"
                  src={prepressStripUrl(uploadId, pageNum, stripX, token)}
                  alt=""
                  className="block h-[220px] w-[240px] border border-gray-300 bg-gray-100 object-none object-center md:h-[420px]"
                />
              ) : (
                <div
                  data-testid="detail-strip-empty"
                  className="flex h-[220px] w-[240px] items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 md:h-[420px]"
                >
                  <Ban size={20} className="text-gray-300" />
                </div>
              )}
              <div className="mt-1 text-center text-[11px] text-gray-400">
                {splits ? '1:1' : '\u00a0'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-b border-t border-gray-200 bg-white px-4 py-3">
            {/* Lehe vahetus — sama kuju ja klahvid nagu Manage pildiredaktoris.
                Joont nihutab kasutaja AINULT hiirega (käepide või klõps pildil). */}
            <div className="flex items-center gap-1">
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
              <button
                type="button"
                className={`rounded border px-3 py-1 text-sm ${
                  page.mode === 'default'
                    ? 'border-primary-600 bg-primary-50 font-medium text-primary-700'
                    : 'border-gray-300'
                }`}
                onClick={() => onPageChange(pageNum, { mode: 'default', split_x: null })}
              >
                {t('step3split.resetToGlobal')}
              </button>
              <button
                type="button"
                aria-pressed={noSplitMode}
                className={`rounded border px-3 py-1 text-sm ${
                  noSplitMode
                    ? 'border-gray-900 bg-gray-900 font-medium text-white'
                    : 'border-gray-300'
                }`}
                onClick={() => onPageChange(pageNum, {
                  mode: noSplitMode ? 'default' : 'nosplit', split_x: null,
                })}
              >
                {t('step3split.noSplit')}
              </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default SplitPageDetail;
