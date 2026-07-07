import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { fetchWorkRelations, type WorkRelation } from '../services/prosopographyService';

const INITIAL_LIMIT = 10;

const WorkRelationsCard: React.FC<{ personId: string }> = ({ personId }) => {
  const { t } = useTranslation(['prosopography', 'workspace']);
  const [relations, setRelations] = useState<WorkRelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchWorkRelations(personId, { limit: INITIAL_LIMIT + 1 })
      .then(data => {
        setHasMore(data.length > INITIAL_LIMIT);
        setRelations(data.slice(0, INITIAL_LIMIT));
        setOffset(INITIAL_LIMIT);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [personId]);

  const loadMore = () => {
    fetchWorkRelations(personId, { limit: INITIAL_LIMIT + 1, offset })
      .then(data => {
        setHasMore(data.length > INITIAL_LIMIT);
        setRelations(prev => [...prev, ...data.slice(0, INITIAL_LIMIT)]);
        setOffset(prev => prev + INITIAL_LIMIT);
      })
      .catch(() => {});
  };

  if (loading) return null;
  if (relations.length === 0) return null;

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
        <span className="text-primary-600"><ArrowLeftRight size={18} /></span>
        <h4 className="font-bold">{t('workRelations', 'Seosed teoste kaudu')}</h4>
        <span className="text-xs text-gray-400 font-normal">({relations.length}{hasMore ? '+' : ''})</span>
      </div>

      <div className="space-y-1">
        {relations.map(rel => (
          <div key={rel.person_id}>
            <button
              onClick={() => setExpanded(e => e === rel.person_id ? null : rel.person_id)}
              className="w-full flex items-center justify-between py-2 -mx-1 px-1 rounded hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                {expanded === rel.person_id
                  ? <ChevronDown size={13} className="shrink-0 text-gray-400" />
                  : <ChevronRight size={13} className="shrink-0 text-gray-400" />
                }
                <Link
                  to={`/persons/${rel.person_id}`}
                  onClick={e => e.stopPropagation()}
                  className="text-sm text-primary-700 hover:underline truncate"
                >
                  {rel.person_name}
                </Link>
              </div>
              <span className="text-xs text-gray-400 shrink-0 ml-3">
                {t('sharedWorks', { count: rel.shared_works_count })}
              </span>
            </button>

            {expanded === rel.person_id && (
              <div className="ml-5 mt-1 mb-2 space-y-1">
                {rel.shared_works.map(w => (
                  <div key={w.work_id} className="flex items-start gap-2 text-xs text-gray-600 py-1">
                    <BookOpen size={11} className="shrink-0 text-gray-300 mt-0.5" />
                    <div className="min-w-0">
                      <Link
                        to={`/work/${w.work_id}/1`}
                        className="hover:text-primary-700 hover:underline truncate block"
                      >
                        {w.work_title || w.work_id}
                        {w.work_year ? ` (${w.work_year})` : ''}
                      </Link>
                      <span className="text-gray-400">
                        {w.a_roles.map(r => t(`workspace:metadata.roles.${r}`, { defaultValue: r })).join(', ')}
                        {' ↔ '}
                        {w.b_roles.map(r => t(`workspace:metadata.roles.${r}`, { defaultValue: r })).join(', ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          className="mt-3 w-full text-xs text-gray-500 hover:text-primary-600 py-1.5 border border-gray-200 rounded hover:border-primary-300 transition-colors"
        >
          {t('loadMore', 'Lae veel')}
        </button>
      )}
    </div>
  );
};

export default WorkRelationsCard;
