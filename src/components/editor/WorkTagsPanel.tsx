import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, ExternalLink, Search, User } from 'lucide-react';
import type { Work } from '../../types';
import { getEntityUrl } from '../../utils/entityUrl';
import { getLabel } from '../../utils/metadataUtils';

interface WorkTagsPanelProps {
  work?: Work;
  lang: string;
}

const WorkTagsPanel: React.FC<WorkTagsPanelProps> = ({ work, lang }) => {
  const { t } = useTranslation(['workspace', 'common', 'dashboard']);
  const navigate = useNavigate();

  if (!work?.tags?.length) return null;

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
        <BookOpen size={18} className="text-green-600" />
        <h4 className="font-bold">{t('metadata.tags')}</h4>
      </div>
      <div className="flex flex-wrap gap-2">
        {work.tags.map((tag, idx) => {
          const label = getLabel(tag, lang);
          const tagId = typeof tag !== 'string' ? (tag as any).id : null;
          const entityType = typeof tag !== 'string' ? (tag as any).entity_type : null;
          const isPersonTag = entityType === 'person' || tagId?.startsWith('vutt:P');
          const prosopoId = tagId?.startsWith('vutt:P') ? tagId : null;
          if (isPersonTag) {
            return prosopoId ? (
              <Link
                key={idx}
                to={`/persons/${prosopoId}`}
                className="inline-flex items-center gap-1.5 bg-primary-50 border border-primary-200 rounded-full px-2.5 py-1 text-sm text-primary-700 hover:bg-primary-100 transition-colors"
                title={t('dashboard:workCard.viewPerson', 'Vaata isiku lehte')}
              >
                <User size={12} className="opacity-60" />
                {label}
              </Link>
            ) : (
              <a
                key={idx}
                href={getEntityUrl(tagId, (tag as any).source) ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 bg-primary-50 border border-primary-200 rounded-full px-2.5 py-1 text-sm text-primary-700 hover:bg-primary-100 transition-colors"
              >
                <User size={12} className="opacity-60" />
                {label}
                <ExternalLink size={10} className="opacity-50" />
              </a>
            );
          }
          return (
            <div key={idx} className="inline-flex items-center bg-green-50 border border-green-100 rounded-full overflow-hidden">
              <button
                onClick={() => navigate(`/search?teoseTags=${encodeURIComponent(label)}`)}
                className="px-2.5 py-1 text-sm text-green-800 hover:bg-green-100 transition-colors flex items-center gap-1"
                title={`Otsi žanrit: ${label}`}
              >
                {label}
                <Search size={12} className="opacity-50" />
              </button>
              {getEntityUrl(tagId, typeof tag !== 'string' ? (tag as any).source : undefined) && (
                <a
                  href={getEntityUrl(tagId, typeof tag !== 'string' ? (tag as any).source : undefined)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pr-2 pl-1 py-1 text-green-600 hover:text-green-800 hover:bg-green-100 border-l border-green-100 transition-colors h-full flex items-center"
                  title={tagId || ''}
                >
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WorkTagsPanel;
