import React from 'react';
import { useTranslation } from 'react-i18next';
import { Work, WorkStatus } from '../types';
import { BookOpen, Calendar, User, Tag, CheckSquare, Square } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getLabel } from '../utils/metadataUtils';

interface WorkCardProps {
  work: Work;
  // Multi-select režiim (optional)
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

const WorkCard: React.FC<WorkCardProps> = ({ work, selectMode = false, isSelected = false, onToggleSelect }) => {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const navigate = useNavigate();
  const location = useLocation();

  // Kasuta denormaliseeritud teose staatust (work.work_status)
  const workStatus = work.work_status || 'Toores';

  // Select mode: klikkimine kaardil lülitab valiku
  const handleCardClick = (e: React.MouseEvent) => {
    if (selectMode && onToggleSelect) {
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect();
    }
  };

  // Navigeeri töölaudale
  const handleOpenWorkspace = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(`/work/${work.id}/1`);
  };

  // Staatuse badge stiilid
  const getStatusStyle = (status?: WorkStatus) => {
    switch (status) {
      case 'Valmis':
        return 'text-green-600 bg-green-50';
      case 'Töös':
        return 'text-amber-600 bg-amber-50';
      case 'Toores':
      default:
        return 'text-gray-500 bg-gray-50';
    }
  };

  const tags = work.tags || [];
  const lang = i18n.language || 'et';

  return (
    <div
      className={`bg-white border rounded-lg shadow-sm hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden ${
        selectMode ? 'cursor-pointer' : ''
      } ${
        isSelected
          ? 'border-primary-500 ring-2 ring-primary-200'
          : 'border-gray-200'
      }`}
      onClick={handleCardClick}
    >
      <div className="h-40 bg-gray-100 relative overflow-hidden group">
        {/* Checkbox select mode'is */}
        {selectMode && (
          <div
            className="absolute top-2 left-2 z-10"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.();
            }}
          >
            {isSelected ? (
              <CheckSquare className="w-6 h-6 text-primary-600 bg-white rounded" />
            ) : (
              <Square className="w-6 h-6 text-gray-400 bg-white/80 rounded hover:text-primary-500" />
            )}
          </div>
        )}
        <img
          src={work.thumbnail_url}
          alt={work.title}
          loading="lazy"
          className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
        />
        {/* Žanrid pildi peal (max 3, kompaktne) */}
        {tags.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent pt-8 pb-2 px-2">
            <div className="flex flex-wrap items-center gap-1">
              {tags.slice(0, 3).map((tag, idx) => {
                const label = getLabel(tag, lang);
                return (
                  <button
                    key={idx}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Navigeeri otsingusse selle žanriga
                      navigate(`/search?teoseTags=${encodeURIComponent(label)}`);
                    }}
                    className="text-[10px] font-medium text-white bg-slate-800/60 hover:bg-primary-600/80 px-1.5 py-0.5 rounded backdrop-blur-sm transition-colors"
                    title={t('workCard.searchGenre', { genre: label })}
                  >
                    {label}
                  </button>
                );
              })}
              {tags.length > 3 && (
                <span
                  className="text-[10px] text-white/80 bg-slate-800/40 px-1.5 py-0.5 rounded"
                  title={tags.slice(3).map(t => getLabel(t, lang)).join(', ')}
                >
                  +{tags.length - 3}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <h3 className="text-lg font-bold text-gray-900 mb-1 leading-tight line-clamp-2">
          <a
            href={`/work/${work.id}/1`}
            onClick={handleOpenWorkspace}
            className="hover:text-primary-600 transition-colors cursor-pointer"
          >
            {work.title}
          </a>
        </h3>

        <div className="mt-2 space-y-2 text-sm text-gray-600 flex-1">
          <button
            onClick={(e) => {
              e.preventDefault();
              // Navigate to search page with author name (finds all occurrences)
              navigate(`/search?q="${encodeURIComponent(work.author || '')}"`);
            }}
            className="flex items-center gap-2 hover:text-primary-600 transition-colors text-left w-full"
            title={t('workCard.searchAuthor', 'Otsi autorit kõikidest teostest')}
          >
            <User size={14} />
            <span className="truncate">
              {work.author}
              {work.respondens && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(`/search?q="${encodeURIComponent(work.respondens!)}"`);
                  }}
                  className="text-gray-400 font-normal hover:text-indigo-600"
                  title={t('workCard.searchRespondens', 'Otsi respondenti kõikidest teostest')}
                >
                  {' / '}{work.respondens}
                </button>
              )}
            </span>
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              // Navigate to dashboard with year filter
              navigate(`/?ys=${work.year}&ye=${work.year}`);
            }}
            className="flex items-center gap-2 hover:text-primary-600 transition-colors text-left w-full"
            title={t('workCard.filterByYear')}
          >
            <Calendar size={14} />
            <span>{work.year}</span>
          </button>
          <div className="flex items-center gap-2">
            <BookOpen size={14} />
            <span>{work.page_count} {t('common:labels.pages')}</span>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center">
          <button
            onClick={(e) => {
              e.preventDefault();
              navigate(`/?status=${encodeURIComponent(workStatus)}`);
            }}
            className={`text-xs font-medium px-2 py-1 rounded-full cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all ${getStatusStyle(workStatus)}`}
            title={t('workCard.filterByStatus', { status: t(`common:status.${workStatus}`) })}
          >
            {t(`common:status.${workStatus}`)}
          </button>
          <a
            href={`/work/${work.id}/1`}
            onClick={handleOpenWorkspace}
            className="text-sm font-medium text-primary-600 hover:text-primary-800 cursor-pointer"
          >
            {t('workCard.openWorkspace')} &rarr;
          </a>
        </div>
      </div >
    </div >
  );
};

export default WorkCard;