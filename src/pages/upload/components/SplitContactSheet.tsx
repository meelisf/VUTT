import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Columns2, Eye, EyeOff, Loader2, Maximize2 } from 'lucide-react';
import { prepressPreviewUrl } from '../uploadApi';
import { isPreviewReady, willSplit } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';

interface Props {
  uploadId: string;
  token: string | null;
  plan: PrepressPlan;
  gridCols: number;
  selected: Set<number>;
  onToggleSelect: (n: number, shiftKey: boolean) => void;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onOpenPage: (n: number) => void;
}

/** Nurgaikooni kest — sama geomeetria kui PageCard tegevusnupul.
 *  must = see leht erineb vaikeolekust (§8); hall = vaikeolek. */
const cornerBtn = (active: boolean) =>
  `p-1 rounded shadow-sm border transition-colors ${
    active
      ? 'bg-gray-900 border-gray-900 text-white'
      : 'bg-white/90 border-gray-600 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
  }`;

/**
 * Lehtede ülevaatuse ruudustik. Karkass on `manage/PageCard`-ist (sama kest,
 * märkeruut, nurgad), žestid ülevaatuse omad: klõps pisipildil VALIB,
 * täisvaate avab eraldi nurgaikoon (§4).
 */
const SplitContactSheet: React.FC<Props> = ({
  uploadId, token, plan, gridCols, selected, onToggleSelect, onPageChange, onOpenPage,
}) => {
  const { t } = useTranslation(['upload']);

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
        return (
          <div
            key={page.n}
            data-testid={`page-${page.n}`}
            data-excluded={page.excluded ? 'true' : 'false'}
            className={`relative flex flex-col rounded-lg border overflow-hidden bg-white ${
              isSelected ? 'border-primary-500 ring-2 ring-primary-400' : 'border-gray-200'
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
                  src={prepressPreviewUrl(uploadId, page.n, token)}
                  alt={`${page.n}`}
                  loading="lazy"
                  /* Tuhmub PILT, mitte kaart — muidu tuhmuvad ka ikoonid ja
                     väljajätmist ei saa kaardilt tagasi võtta (§8). Tuhmus
                     tähendab täpselt üht asja: ei lähe OCR-i (§11). */
                  className={`w-full h-full object-cover ${page.excluded ? 'opacity-35' : ''}`}
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
                  style={{ left: `${x * 100}%` }}
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

              {/* Kolm nurgaikooni: [silm] [|] [suurenda] — OCR, poolitus, ava (§4) */}
              <div className="absolute bottom-1 right-1 z-10 flex items-center gap-1">
                <button
                  type="button"
                  data-testid={`exclude-${page.n}`}
                  onClick={(e) => { e.stopPropagation(); onPageChange(page.n, { excluded: !page.excluded }); }}
                  aria-pressed={page.excluded}
                  title={page.excluded ? t('step3split.card.include') : t('step3split.card.exclude')}
                  className={cornerBtn(page.excluded)}
                >
                  {page.excluded ? <EyeOff size={14} /> : <Eye size={14} />}
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
                  aria-pressed={page.mode !== 'nosplit'}
                  title={page.mode === 'nosplit' ? t('step3split.card.split') : t('step3split.card.noSplit')}
                  className={cornerBtn(page.mode !== 'nosplit')}
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
                  <Maximize2 size={14} />
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
