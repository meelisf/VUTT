import React from 'react';
import { Work, WorkStatus } from '../types';
import { BookOpen, Calendar, User, Tag } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';

interface WorkCardProps {
  work: Work;
}

const WorkCard: React.FC<WorkCardProps> = ({ work }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Kasuta denormaliseeritud teose staatust (work.work_status)
  const workStatus = work.work_status || 'Toores';

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

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col overflow-hidden">
      <div className="h-40 bg-gray-100 relative overflow-hidden group">
        <img
          src={work.thumbnail_url}
          alt={work.title}
          loading="lazy"
          className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
        />
        {/* Žanrid pildi peal */}
        {work.teose_tags && work.teose_tags.length > 0 && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-3">
            <div className="flex flex-wrap gap-1">
              {work.teose_tags.slice(0, 6).map((tag, idx) => (
                <button
                  key={idx}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Navigeeri otsingusse selle žanriga
                    navigate(`/search?teoseTags=${encodeURIComponent(tag)}`);
                  }}
                  className="text-[10px] font-bold text-white bg-slate-900/40 hover:bg-green-700/50 px-2 py-0.5 rounded border border-gray-500/30 backdrop-blur-sm transition-colors uppercase tracking-wider"
                  title={`Otsi žanrit: ${tag}`}
                >
                  {tag.toLowerCase()}
                </button>
              ))}
              {work.teose_tags.length > 6 && (
                <span className="text-xs text-white/70 px-1">+{work.teose_tags.length - 6}</span>
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
              // Navigate to dashboard with author filter (exact match)
              navigate(`/?author=${encodeURIComponent(work.author)}`);
            }}
            className="flex items-center gap-2 hover:text-primary-600 transition-colors text-left w-full"
            title="Filtreeri autori järgi"
          >
            <User size={14} />
            <span className="truncate">
              {work.author}
              {work.respondens && <span className="text-gray-400 font-normal"> / {work.respondens}</span>}
            </span>
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              // Navigate to dashboard with year filter
              navigate(`/?ys=${work.year}&ye=${work.year}`);
            }}
            className="flex items-center gap-2 hover:text-primary-600 transition-colors text-left w-full"
            title="Filtreeri aasta järgi"
          >
            <Calendar size={14} />
            <span>{work.year}</span>
          </button>
          <div className="flex items-center gap-2">
            <BookOpen size={14} />
            <span>{work.page_count} lk</span>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center">
          <button
            onClick={(e) => {
              e.preventDefault();
              navigate(`/?status=${encodeURIComponent(workStatus)}`);
            }}
            className={`text-xs font-medium px-2 py-1 rounded-full cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all ${getStatusStyle(workStatus)}`}
            title={`Filtreeri staatuse "${workStatus}" järgi`}
          >
            {workStatus}
          </button>
          <a
            href={`/work/${work.id}/1`}
            onClick={handleOpenWorkspace}
            className="text-sm font-medium text-primary-600 hover:text-primary-800 cursor-pointer"
          >
            Ava töölaud &rarr;
          </a>
        </div>
      </div >
    </div >
  );
};

export default WorkCard;