import React from 'react';
import { useTranslation } from 'react-i18next';
import { EyeOff, Eye, Maximize2, Loader2, Droplet } from 'lucide-react';
import { prepressPreviewUrl } from '../uploadApi';
import { inkLevel, isPreviewReady, willSplit } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';

const BORDER: Record<string, string> = {
  ok: 'border-green-500',
  warn: 'border-amber-500',
  bad: 'border-red-600',
};

interface Props {
  uploadId: string;
  token: string | null;
  plan: PrepressPlan;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onOpenPage: (n: number) => void;
}

/**
 * 100 DPI pisipiltide ruudustik. Tindiskoor tõstab kahtlased esile, aga
 * pisipilt ise ei tõesta midagi — klikk viib köitevahe-ribale või üksiklehele.
 */
const SplitContactSheet: React.FC<Props> = ({
  uploadId, token, plan, onPageChange, onOpenPage,
}) => {
  const { t } = useTranslation(['upload']);

  return (
    <div
      data-testid="split-contact-sheet"
      className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
    >
      {plan.pages.map((page) => {
        const level = inkLevel(page.ink);
        const ready = isPreviewReady(plan, page.n);
        const splits = willSplit(plan, page.n);
        const x = page.mode === 'custom' && page.split_x != null
          ? page.split_x
          : plan.default_split_x;
        return (
          <div
            key={page.n}
            data-testid={`page-${page.n}`}
            data-ink-level={level}
            data-excluded={page.excluded ? 'true' : 'false'}
            className={`relative ${page.excluded ? 'opacity-35' : ''}`}
          >
            <button
              type="button"
              data-testid={`open-${page.n}`}
              title={t('step3split.openPage')}
              className={`block w-full border-2 ${BORDER[level]}`}
              disabled={!ready}
              onClick={() => onOpenPage(page.n)}
            >
              {ready ? (
                <img
                  src={prepressPreviewUrl(uploadId, page.n, token)}
                  alt={`${page.n}`}
                  loading="lazy"
                  className="block w-full"
                />
              ) : (
                <div
                  data-testid={`placeholder-${page.n}`}
                  className="flex aspect-[3/4] w-full items-center justify-center bg-gray-100"
                >
                  <Loader2 size={18} className="animate-spin text-gray-400" />
                </div>
              )}
            </button>

            {ready && splits && (
              <div
                data-testid={`line-${page.n}`}
                className="absolute top-0 bottom-0 w-px bg-rose-600 pointer-events-none"
                style={{ left: `${x * 100}%` }}
              />
            )}

            <div className="absolute top-1 left-1 flex gap-1">
              <span className="text-[10px] px-1 rounded bg-black/60 text-white">{page.n}</span>
              {level !== 'ok' && (
                <span
                  className="flex items-center gap-0.5 rounded bg-red-700 px-1 text-[10px] text-white"
                  title={`${t('step3split.inkWarning')} — ${t('step3split.inkLegend')} ${t('step3split.inkMeasuredAt')}`}
                >
                  <Droplet size={9} />
                  {page.ink?.toFixed(2)}
                </span>
              )}
            </div>

            <div className="absolute top-1 right-1 flex gap-1">
              <button
                type="button"
                data-testid={`exclude-${page.n}`}
                title={page.excluded ? t('step3split.include') : t('step3split.exclude')}
                className="p-1 rounded bg-black/60 text-white"
                onClick={() => onPageChange(page.n, { excluded: !page.excluded })}
              >
                {page.excluded ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                type="button"
                data-testid={`nosplit-${page.n}`}
                title={t('step3split.noSplit')}
                className="p-1 rounded bg-black/60 text-white"
                onClick={() => onPageChange(page.n, {
                  mode: page.mode === 'nosplit' ? 'default' : 'nosplit',
                  split_x: null,
                })}
              >
                <Maximize2 size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SplitContactSheet;
