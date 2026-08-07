import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { prepressPreviewUrl, prepressStripUrl } from '../uploadApi';
import { clampSplitX } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';

const NUDGE = 0.005;      // ühe nupuvajutuse samm (0,5% laiusest)
const STRIP_DEBOUNCE_MS = 400;

interface Props {
  uploadId: string;
  token: string | null;
  plan: PrepressPlan;
  pageNum: number;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
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
  uploadId, token, plan, pageNum, onPageChange, onClose,
}) => {
  const { t } = useTranslation(['upload', 'common']);
  const page = plan.pages.find((p) => p.n === pageNum);
  const liveX = page?.mode === 'custom' && page.split_x != null
    ? page.split_x
    : plan.default_split_x;

  const [stripX, setStripX] = useState(liveX);
  const [dragging, setDragging] = useState(false);
  const imageRef = useRef<HTMLDivElement>(null);

  // Debounce: riba päritakse alles pärast pausi.
  useEffect(() => {
    const id = setTimeout(() => setStripX(liveX), STRIP_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [liveX]);

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

  // Escape sulgeb — väikesel ekraanil on see sageli kiirem kui nupp.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!page) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-2 sm:p-4">
      {/* flex-col + max-h: päis on omaette flex-laps ja EI keri kaasa —
          varem oli päis kerimiskonteineri sees ja kadus väikesel ekraanil
          ülemise serva taha. */}
      <div className="my-auto flex max-h-[calc(100vh-1rem)] w-full max-w-6xl flex-col rounded bg-white sm:max-h-[calc(100vh-2rem)]">
        <div className="flex flex-shrink-0 items-center justify-between gap-2 rounded-t border-b border-gray-200 bg-white px-4 py-3">
          <h3 className="font-semibold">
            {pageNum} <span className="ml-2 text-sm font-normal text-gray-500">
              {Math.round(liveX * 1000) / 10}%
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
              className="relative flex-1 cursor-col-resize select-none touch-none"
              onPointerDown={(e) => xFromClient(e.clientX)}
            >
              <img
                src={prepressPreviewUrl(uploadId, pageNum, token)}
                alt={`${pageNum}`}
                className="block w-full"
                draggable={false}
              />
              {/* Joon + käepide: sama kuju nagu Manage-lehe poolitamisel. */}
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
            </div>

            <div className="flex-none self-center md:self-start">
              <img
                data-testid="detail-strip"
                src={prepressStripUrl(uploadId, pageNum, stripX, token)}
                alt=""
                className="block h-[220px] w-auto border md:h-[420px]"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button" data-testid="nudge-left" className="rounded border p-1"
              onClick={() => setX(liveX - NUDGE)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button" data-testid="nudge-right" className="rounded border p-1"
              onClick={() => setX(liveX + NUDGE)}
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button" className="rounded border px-3 py-1 text-sm"
              onClick={() => onPageChange(pageNum, { mode: 'default', split_x: null })}
            >
              {t('step3split.resetToGlobal')}
            </button>
            <button
              type="button" className="rounded border px-3 py-1 text-sm"
              onClick={() => onPageChange(pageNum, { mode: 'nosplit', split_x: null })}
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
