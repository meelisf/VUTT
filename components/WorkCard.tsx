
import React from 'react';
import { Work } from '../types';
import { BookOpen, Calendar, User } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

interface WorkCardProps {
  work: Work;
}

const WorkCard: React.FC<WorkCardProps> = ({ work }) => {
  const navigate = useNavigate();

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 flex flex-col overflow-hidden">
      <div className="h-40 bg-gray-100 relative overflow-hidden group">
        <img
          src={work.thumbnail_url}
          alt={work.title}
          className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-4">
          <span className="text-white font-serif text-sm bg-black/30 px-2 py-1 rounded backdrop-blur-sm">
            {work.catalog_name}
          </span>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <h3 className="text-lg font-bold text-gray-900 mb-1 leading-tight line-clamp-2">
          <Link to={`/work/${work.id}/1`} className="hover:text-primary-600 transition-colors">
            {work.title}
          </Link>
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
          <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
            Indekseeritud
          </span>
          <Link
            to={`/work/${work.id}/1`}
            className="text-sm font-medium text-primary-600 hover:text-primary-800"
          >
            Ava töölaud &rarr;
          </Link>
        </div>
      </div >
    </div >
  );
};

export default WorkCard;