import React, { useState } from 'react';
import type { ImageToken } from '../../../utils/imageTokenUrl';
import { useTranslation } from 'react-i18next';
import { Check, Columns2, Crop, Loader2, RotateCw, SquarePen, X } from 'lucide-react';
import { prepressPreviewUrl } from '../uploadApi';
import { isPreviewReady, willSplit } from '../prepressPlan';
import { cardLineLeftPercent } from '../../../components/pagePrep/geometry';
import type { PrepressPage, PrepressPlan } from '../types';

interface Props {
  uploadId: string;
  ticket: ImageToken | null;
  plan: PrepressPlan;
  gridCols: number;
  selected: Set<number>;
  onToggleSelect: (n: number, shiftKey: boolean) => void;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onOpenPage: (n: number) => void;
}

/** Nurgaikooni kest — sama geomeetria kui PageCard tegevusnupul.
 *  must = seda lehte EI poolitata; hall = poolitatakse / tavaolek. Nurgaikoon ja
 *  täisvaate nupud kannavad SAMA signaali — segased suunad olid varem peamine
 *  arusaamatuse allikas. */
const cornerBtn = (active: boolean) =>
  `p-1 rounded shadow-sm border transition-colors ${
    active
      ? 'bg-gray-900 border-gray-900 text-white'
      : 'bg-white/90 border-gray-600 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
  }`;

/** Väljajätmise nupp: PUNANE rist, sest leht jääb TEOSEST välja (mitte ainult OCR-ist).
 *  Välja jäetud = täidetud punane; muidu tavaline, punane alles hõljudes. */
const excludeBtn = (excluded: boolean) =>
  `p-1 rounded shadow-sm border transition-colors ${
    excluded
      ? 'bg-red-600 border-red-600 text-white hover:bg-red-700'
      : 'bg-white/90 border-gray-600 text-gray-600 hover:border-red-600 hover:bg-red-50 hover:text-red-700'
  }`;

/**
 * Lehtede ülevaatuse ruudustik. Karkass on `manage/PageCard`-ist (sama kest,
 * märkeruut, nurgad), žestid ülevaatuse omad: klõps pisipildil VALIB,
 * täisvaate avab eraldi nurgaikoon (§4).
 */
const SplitContactSheet: React.FC<Props> = ({
  uploadId, ticket, plan, gridCols, selected, onToggleSelect, onPageChange, onOpenPage,
}) => {
  const { t } = useTranslation(['upload']);
  // Pildi loomulik kuvasuhe lehe kaupa — teada alles pärast laadimist.
  const [aspects, setAspects] = useState<Record<number, number>>({});

  return (
    <div
      data-testid="split-contact-sheet"
      className="grid gap-3 p-4"
      style={{ gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}
    >
      {plan.pages.map((page) => {
        const ready = isPreviewReady(plan, page.n);
        const splits = willSplit(plan, page.n);
        const isSelected = selected.has(page.n);
        const x = page.mode === 'custom' && page.split_x != null
          ? page.split_x
          : plan.default_split_x;
        // Joon pildi, mitte kasti järgi (vt cardLineLeftPercent).
        const lineLeft = cardLineLeftPercent(aspects[page.n], x);
        // Ootel muudatus (sama tähendus mis redaktori pisipiltide ribal): kasutaja on
        // lehele midagi määranud. Vaikimisi ei poolitata midagi.
        const pRotate = Boolean(page.rotate);
        const pCrop = Boolean(page.adjust);
        const pending = pRotate || pCrop || splits;
        return (
          <div
            key={page.n}
            data-testid={`page-${page.n}`}
            data-excluded={page.excluded ? 'true' : 'false'}
            data-pending={pending ? 'true' : 'false'}
            // Raam: valik > välja jäetud (punane) > ootel muudatus (oranž, nagu teose halduse kaardil).
            className={`relative flex flex-col rounded-lg border overflow-hidden bg-white ${
              isSelected ? 'border-primary-500 ring-2 ring-primary-400'
                : page.excluded ? 'border-red-400 ring-1 ring-red-300'
                : pending ? 'border-amber-400 ring-1 ring-amber-300'
                : 'border-gray-200'
            }`}
          >
            {/* Kogu pisipildi-ala on valiku-sihtmärk; select-none väldib
                Shift+klõpsu teksti-esiletõstu üle ruudustiku (PageCard muster). */}
            <div
              className="relative aspect-[3/4] bg-gray-100 overflow-hidden cursor-pointer select-none"
              onClick={(e) => onToggleSelect(page.n, e.shiftKey)}
              title={t('step3split.card.select')}
            >
              {ready ? (
                <img
                  src={prepressPreviewUrl(uploadId, page.n, ticket, page.rotate ?? 0, page.adjust ?? null) || undefined}
                  alt={`${page.n}`}
                  loading="lazy"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (!img.naturalHeight) return;
                    const ratio = img.naturalWidth / img.naturalHeight;
                    setAspects((prev) => (prev[page.n] === ratio
                      ? prev
                      : { ...prev, [page.n]: ratio }));
                  }}
                  /* Tuhmub PILT, mitte kaart — muidu tuhmuvad ka ikoonid ja
                     väljajätmist ei saa kaardilt tagasi võtta (§8). Tuhmus
                     tähendab täpselt üht asja: ei lähe OCR-i (§11).

                     `object-contain`, MITTE `cover` (sama kuju nagu
                     UploadStepReview pisipiltidel): poolitamist vajav leht ON
                     lapiti ja peab ka ruudustikus lapiti välja nägema. `cover`
                     lõikas avause küljed portreeks ja peitis just selle. */
                  className={`w-full h-full object-contain ${page.excluded ? 'opacity-35' : ''}`}
                />
              ) : (
                <div
                  data-testid={`placeholder-${page.n}`}
                  className="flex h-full w-full items-center justify-center"
                >
                  <Loader2 size={18} className="animate-spin text-gray-400" />
                </div>
              )}

              {ready && splits && (
                <div
                  data-testid={`line-${page.n}`}
                  className="absolute top-0 bottom-0 w-px bg-rose-600 pointer-events-none"
                  style={{ left: `${lineLeft}%` }}
                />
              )}

              {/* Märkeruut — eraldi klõpsatav, klaviatuuri jaoks */}
              <button
                type="button"
                data-testid={`select-${page.n}`}
                onClick={(e) => { e.stopPropagation(); onToggleSelect(page.n, e.shiftKey); }}
                aria-pressed={isSelected}
                title={t('step3split.card.select')}
                className={`absolute top-1 left-1 z-10 w-5 h-5 flex items-center justify-center rounded border shadow-sm ${
                  isSelected ? 'bg-primary-600 border-primary-600 text-white'
                    : 'bg-white/90 border-gray-600 text-transparent'
                }`}
              >
                <Check size={13} />
              </button>

              {/* Lehenumber — all vasakul. Hall: upload'is seisundit veel ei ole. */}
              <span className="absolute bottom-1 left-1 text-xs px-1 py-0.5 rounded leading-tight shadow-sm bg-gray-100 text-gray-600">
                {page.n}
              </span>

              {/* Ootel muudatuste märk — üleval paremal (samad ikoonid mis pisipiltide ribal).
                  Väljajäetud lehel näitab märgi asemel punast risti: tema muudatused ei rakendu. */}
              {page.excluded ? (
                <span data-testid={`excluded-mark-${page.n}`}
                  className="pointer-events-none absolute right-1 top-1 z-10 rounded bg-red-600 p-0.5 text-white shadow-sm">
                  <X size={12} />
                </span>
              ) : pending && (
                <span data-testid={`pending-${page.n}`} title={t('step3split.card.pendingTitle')}
                  className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1 py-0.5 text-[10px] leading-none text-amber-800 shadow-sm">
                  {pRotate && (<><RotateCw size={11} />{page.rotate}°</>)}
                  {pCrop && (<><Crop size={11} />{t('step3split.card.badgeCrop')}</>)}
                  {splits && (<><Columns2 size={11} />{t('step3split.card.badgeSplit')}</>)}
                </span>
              )}

              {/* Kolm nurgaikooni: [✕] [|] [redaktor] — teosest välja, poolitus, ava redaktor (§4) */}
              <div className="absolute bottom-1 right-1 z-10 flex items-center gap-1">
                <button
                  type="button"
                  data-testid={`exclude-${page.n}`}
                  onClick={(e) => { e.stopPropagation(); onPageChange(page.n, { excluded: !page.excluded }); }}
                  aria-pressed={page.excluded}
                  title={page.excluded ? t('step3split.card.include') : t('step3split.card.exclude')}
                  className={excludeBtn(page.excluded)}
                >
                  <X size={14} />
                </button>
                <button
                  type="button"
                  data-testid={`split-${page.n}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPageChange(page.n, {
                      mode: page.mode === 'nosplit' ? 'default' : 'nosplit',
                      split_x: null,
                    });
                  }}
                  aria-pressed={page.mode === 'nosplit'}
                  title={page.mode === 'nosplit' ? t('step3split.card.split') : t('step3split.card.noSplit')}
                  className={cornerBtn(page.mode === 'nosplit')}
                >
                  <Columns2 size={14} />
                </button>
                <button
                  type="button"
                  data-testid={`open-${page.n}`}
                  onClick={(e) => { e.stopPropagation(); onOpenPage(page.n); }}
                  disabled={!ready}
                  title={t('step3split.card.open')}
                  className={`${cornerBtn(false)} disabled:opacity-40`}
                >
                  {/* Sama ikoon ja tekst mis teose halduse kaardil (ADR 0085): üks redaktor. */}
                  <SquarePen size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SplitContactSheet;
