/**
 * Osade vahekaardi lehtede ruudustik (#464): valik (klikk, Shift-vahemik) ja iga lehe
 * osa märgid (klikk avab osa). Veeru laius tuleb suuruse liugurist; kaart järgib
 * pildi kõrgust (h-auto), et raami ja pildi vahele ei jääks tühja valget.
 * Leht avaneb töölaual uues vahekaardis, et töö siin ei katkeks.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { IMAGE_BASE_URL } from '../../../config';
import type { WorkPageInfo } from '../../../services/workApi';
import type { Badge } from '../partsModel';
import PageThumb from '../PageThumb';
import { KIND_STYLE } from './kindStyle';

interface Props {
  workId: string;
  pages: WorkPageInfo[];
  badges: Map<string, Badge[]>;
  selected: Set<string>;
  activeStems: Set<string>;
  imageToken: { exp: number; sig: string } | null;
  thumbCacheBust: number;
  onToggle: (stem: string, shift: boolean) => void;
  onOpenPart: (id: string) => void;
  /** Veeru minimaalne laius pikslites (suuruse liugur). */
  thumbSize: number;
}

const PartsGrid: React.FC<Props> = ({ workId, pages, badges, selected, activeStems, imageToken, thumbCacheBust, onToggle, onOpenPart, thumbSize }) => {
  const { t } = useTranslation(['workspace']);
  const tokenQuery = imageToken ? `&exp=${imageToken.exp}&sig=${imageToken.sig}` : '';
  return (
    <div
      data-testid="parts-grid"
      className="grid items-start gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${thumbSize}px, 100%), 1fr))` }}
    >
      {pages.map(page => {
        const stem = page.base_name;
        const isSel = selected.has(stem);
        const isActive = activeStems.has(stem);
        const imageName = page.lehekylje_pilt.split('/').pop() ?? '';
        return (
          <div
            key={page.filename}
            data-testid={`page-${stem}`}
            role="button"
            tabIndex={0}
            aria-pressed={isSel}
            onClick={e => onToggle(stem, e.shiftKey)}
            onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(stem, e.shiftKey); } }}
            className={`relative cursor-pointer select-none overflow-hidden rounded-md border bg-white transition-shadow ${
              isSel ? 'border-primary-500 ring-2 ring-primary-400' : isActive ? 'border-amber-400 ring-2 ring-amber-300' : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <PageThumb
              workId={workId}
              src={`${IMAGE_BASE_URL}/${workId}/_thumbs/_thumb_${imageName}?v=${thumbCacheBust}${tokenQuery}`}
              className="block h-auto min-h-16 w-full bg-gray-50"
            />
            <div className="flex items-center justify-between gap-1 border-t border-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
              <span className="tabular-nums">{page.page_num}</span>
              <a
                href={`/work/${workId}/${page.page_num}`}
                target="_blank"
                rel="noopener"
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
                title={t('manage.parts.openPage')}
                aria-label={t('manage.parts.openPage')}
                className="text-gray-400 hover:text-primary-600"
              >
                <ExternalLink size={12} />
              </a>
            </div>
            {(badges.get(stem) ?? []).length > 0 && (
              <div className="absolute left-1 top-1 flex flex-wrap gap-1">
                {badges.get(stem)!.map(b => (
                  <button
                    type="button"
                    key={b.partId}
                    data-testid={`badge-${stem}-${b.partId}`}
                    title={t(`manage.parts.kinds.${b.kind}`)}
                    aria-label={t('manage.parts.openPart', { name: `${b.index} ${t(`manage.parts.kinds.${b.kind}`)}` })}
                    onClick={e => { e.stopPropagation(); onOpenPart(b.partId); }}
                    onKeyDown={e => e.stopPropagation()}
                    className={`rounded px-1.5 text-[11px] font-semibold leading-5 shadow-sm hover:brightness-95 ${KIND_STYLE[b.kind]}`}
                  >
                    {b.index}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PartsGrid;
