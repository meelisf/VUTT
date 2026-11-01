import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PartPersonsHint from './PartPersonsHint';
import RelationsButton from './relations/RelationsButton';
import { Check } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Work } from '../types';
import { getLabel } from '../utils/metadataUtils';
import { getLangCode } from '../utils/getLangCode';
import { useWorkThumbnail } from '../hooks/useWorkThumbnail';
import { formatYearDisplay } from '../utils/yearDisplayUtils';
import { workDisplayTitle } from '../utils/workTitle';
import { workStatusDotClass } from '../utils/workStatusDot';

interface WorkListRowProps {
  work: Work;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (shiftKey: boolean) => void;
}

/**
 * Teos loendivaates (#587): väike pisipilt ja TÄISPEALKIRI. Autor on link nagu kaardil;
 * aasta ja žanri filtrilingid jäävad kaardile — muu rida on navigeerimine teosele.
 */
const WorkListRow: React.FC<WorkListRowProps> = ({ work, selectMode = false, isSelected = false, onToggleSelect }) => {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const navigate = useNavigate();
  // Täispisipilt, mitte kaardi kastile lõigatud kaas — real on leht püsti näha
  const { thumbnailSrc, handleThumbnailError } = useWorkThumbnail(work, work.page_thumbnail_url || work.thumbnail_url);
  const lang = getLangCode(i18n.language);
  const displayTitle = workDisplayTitle(work, lang);
  const workStatus = work.work_status || 'Toores';
  const href = `/work/${work.work_id}/1`;

  const genres = Array.isArray(work.genre) ? work.genre : work.genre ? [work.genre] : [];
  const creators = (work.creators || []).filter(c => c.name);
  const typeLabel = work.type ? getLabel(work.type, lang) : '';

  const [relationsOpen, setRelationsOpen] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (selectMode) onToggleSelect?.(e.shiftKey);
    else navigate(href);
  };

  return (
    <div
      onClick={handleClick}
      className={`group flex gap-4 px-4 py-3 border-b border-gray-100 last:border-0 cursor-pointer transition-colors ${
        isSelected ? 'bg-primary-50' : 'hover:bg-primary-50/40'
      } ${selectMode ? 'select-none' : ''}`}
    >
      {selectMode && (
        <span
          className={`self-center w-5 h-5 shrink-0 flex items-center justify-center rounded border transition-colors ${
            isSelected ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-gray-400 text-transparent'
          }`}
          aria-hidden
        >
          <Check size={13} />
        </span>
      )}
      <div className="w-10 h-14 shrink-0 bg-gray-100 rounded-sm overflow-hidden">
        <img
          src={thumbnailSrc}
          alt=""
          loading="lazy"
          onError={handleThumbnailError}
          className="w-full h-full object-contain"
        />
      </div>
      <div className="flex-1 min-w-0">
        <a
          href={href}
          onClick={(e) => {
            e.stopPropagation();
            // Ctrl/Cmd-klikk avab uue vahelehe nagu tavaline link
            if (!selectMode && (e.metaKey || e.ctrlKey)) return;
            handleClick(e);
          }}
          className="font-semibold text-gray-900 leading-snug group-hover:text-primary-700"
        >
          {displayTitle.main}
        </a>
        {/* Seoste nupp (#701): popover nupu juurest, klõpsud ei jõua rea onClick-ini */}
        {!selectMode && (
          <span className="ml-2">
            <RelationsButton
              workId={work.work_id}
              relations={work.relations}
              convoluteCount={work.convolute_count}
              variant="row"
              lang={lang}
              open={relationsOpen}
              onOpenChange={setRelationsOpen}
            />
          </span>
        )}
        {displayTitle.secondary && (
          <div className="text-sm italic text-gray-500 line-clamp-1" title={displayTitle.secondary}>
            {displayTitle.secondary}
          </div>
        )}
        <div className="mt-1 text-sm text-gray-600 flex flex-wrap gap-x-4 gap-y-0.5">
          {creators.length > 0 && (
            <span>
              {creators.map((c, i) => (
                <React.Fragment key={i}>
                  {i > 0 && ', '}
                  {/* Isikukaardiga autor viib kaardile; ilma kaardita autor jääb otsinguks (nagu WorkCard) */}
                  <Link
                    to={c.id?.startsWith('vutt:P')
                      ? `/persons/${c.id}`
                      : `/?${c.role === 'respondens' ? 'respondens' : 'author'}=${encodeURIComponent(c.name)}`}
                    onClick={(e) => { e.stopPropagation(); if (selectMode) { e.preventDefault(); onToggleSelect?.(e.shiftKey); } }}
                    className="hover:text-primary-600 hover:underline"
                  >
                    {c.name}
                  </Link>
                </React.Fragment>
              ))}
            </span>
          )}
          <span className="tabular-nums">{formatYearDisplay(work.year_display, work.year, t, work.dating)}</span>
          <span className="tabular-nums">{work.page_count} {t('common:labels.pages')}</span>
          {typeLabel && <span className="text-gray-400">{typeLabel}</span>}
        </div>
        <PartPersonsHint names={work.matched_part_persons} className="mt-0.5" />
      </div>
      <div className="hidden sm:flex flex-col items-end gap-2 shrink-0">
        {genres.length > 0 && (
          <span className="text-[13px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 max-w-[10rem] truncate">
            {getLabel(genres[0], lang)}
          </span>
        )}
        <span
          className={`w-2.5 h-2.5 rounded-full ${workStatusDotClass(workStatus)}`}
          title={t(`common:status.${workStatus}`)}
        />
      </div>
    </div>
  );
};

export default WorkListRow;
