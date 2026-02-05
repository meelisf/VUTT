/**
 * Mobiilne read-only vaade Workspace'ile.
 * Tab-ide abil saab vaadata pilti, teksti VÕI teose infot täiskraanina
 * (desktop 50/50 jaotuse asemel, mis mobiilis ei tööta).
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Home, ChevronLeft, ChevronRight, BookOpen, User, ExternalLink, Bookmark, FolderOpen } from 'lucide-react';
import ImageViewer from '../ImageViewer';
import LanguageSwitcher from '../LanguageSwitcher';
import type { Page, Work } from '../../types';
import { getLabel } from '../../utils/metadataUtils';
import { getEntityUrl } from '../../utils/entityUrl';
import { useCollection } from '../../contexts/CollectionContext';
import { getCollectionColorClasses, getCollectionHierarchy } from '../../services/collectionService';

interface WorkspaceMobileViewProps {
  page: Page;
  work?: Work;
  workId: string;
  currentPageNum: number;
  onNavigatePage: (delta: number) => void;
  onNavigateBack: () => void;
  inputPage: string;
  onInputPageChange: (value: string) => void;
  onPageInputSubmit: () => void;
}

const WorkspaceMobileView: React.FC<WorkspaceMobileViewProps> = ({
  page,
  work,
  workId,
  currentPageNum,
  onNavigatePage,
  onNavigateBack,
  inputPage,
  onInputPageChange,
  onPageInputSubmit,
}) => {
  const { t, i18n } = useTranslation(['workspace', 'common', 'dashboard']);
  const navigate = useNavigate();
  const { collections, getCollectionPath } = useCollection();
  const lang = (i18n.language as 'et' | 'en') || 'et';
  const [activeTab, setActiveTab] = useState<'image' | 'text' | 'info'>('image');

  return (
    <div className="flex flex-col h-full">
      {/* Kompaktne navigatsiooniriba */}
      <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onNavigateBack}
            className="p-1.5 hover:bg-gray-100 rounded-md text-gray-600 transition-colors"
            title={t('navigation.backToDashboard')}
          >
            <Home size={16} />
          </button>
          <span className="text-xs text-gray-500">ID:</span>
          <span className="font-mono text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded text-xs">
            {workId}
          </span>
        </div>

        {/* Lehekülje navigatsioon */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onNavigatePage(-1)}
            disabled={currentPageNum <= 1}
            className="p-1 hover:bg-gray-100 rounded text-gray-600 disabled:opacity-30 transition-all"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500">{t('navigation.page')}</span>
            <input
              className="w-10 text-center text-sm font-medium border border-gray-300 rounded px-1 py-0.5 focus:ring-2 focus:ring-primary-500 outline-none text-gray-700"
              value={inputPage}
              onChange={(e) => onInputPageChange(e.target.value)}
              onBlur={onPageInputSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onPageInputSubmit();
                  e.currentTarget.blur();
                }
              }}
            />
            {work?.page_count && (
              <span className="text-xs text-gray-500">/{work.page_count}</span>
            )}
          </div>
          <button
            onClick={() => onNavigatePage(1)}
            disabled={work?.page_count ? currentPageNum >= work.page_count : false}
            className="p-1 hover:bg-gray-100 rounded text-gray-600 disabled:opacity-30 transition-all"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <LanguageSwitcher />
      </div>

      {/* Tab-riba */}
      <div className="flex bg-gray-100 p-1 mx-3 mt-2 rounded-lg shadow-inner shrink-0">
        <button
          onClick={() => setActiveTab('image')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'image'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('mobile.imageTab')}
        </button>
        <button
          onClick={() => setActiveTab('text')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'text'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('mobile.textTab')}
        </button>
        <button
          onClick={() => setActiveTab('info')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'info'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t('mobile.infoTab')}
        </button>
      </div>

      {/* Täiskraani sisu */}
      <div className="flex-1 min-h-0 overflow-hidden mt-2">
        {activeTab === 'image' ? (
          <div className="h-full bg-slate-900">
            {page.image_url ? (
              <ImageViewer src={page.image_url} />
            ) : (
              <div className="flex items-center justify-center h-full text-white/50">
                Pilt puudub
              </div>
            )}
          </div>
        ) : activeTab === 'text' ? (
          <div className="h-full overflow-y-auto bg-white px-4 pt-3 pb-16">
            <div className="whitespace-pre-wrap font-serif text-gray-800 leading-relaxed text-base">
              {page.text_content || t('editor.placeholder')}
            </div>
          </div>
        ) : (
          /* Info tab - teose metaandmed (read-only) */
          <div className="h-full overflow-y-auto bg-gray-50 px-4 pt-4 pb-16">
            {work ? (
              <div className="space-y-4">
                {/* Pealkiri */}
                <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-3 text-gray-800 border-b border-gray-100 pb-2">
                    <BookOpen size={16} className="text-primary-600" />
                    <h4 className="font-bold text-sm">{t('info.workInfo')}</h4>
                  </div>
                  <div className="space-y-3 text-sm">
                    {/* Pealkiri */}
                    <div>
                      <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.workTitle')}</span>
                      <p className="text-gray-900 font-medium">{work.title}</p>
                    </div>

                    {/* Isikud */}
                    {work.creators && work.creators.length > 0 && (
                      <div>
                        <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1.5">{t('metadata.creators')}</span>
                        <div className="space-y-1.5">
                          {work.creators.map((creator, idx) => {
                            const roleLabel = t(`metadata.roles.${creator.role}`, { defaultValue: creator.role });
                            return (
                              <div key={idx} className="flex items-center gap-2 flex-wrap">
                                <div className="flex items-center gap-1.5 text-gray-900">
                                  <User size={13} className="text-gray-400 shrink-0" />
                                  <span className="font-medium">{creator.name}</span>
                                </div>
                                {getEntityUrl(creator.id, creator.source) && (
                                  <a
                                    href={getEntityUrl(creator.id, creator.source)!}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-gray-400 hover:text-blue-600 p-0.5"
                                    title={creator.id || ''}
                                  >
                                    <ExternalLink size={11} />
                                  </a>
                                )}
                                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{roleLabel}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Aasta, tüüp, koht, trükkal */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.year')}</span>
                        <p className="text-gray-900">{work.year}</p>
                      </div>
                      {work.type && (
                        <div>
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.type')}</span>
                          <div className="flex items-center gap-1">
                            <p className="text-gray-900">{getLabel(work.type_object || work.type, lang)}</p>
                            {getEntityUrl(work.type_object?.id, work.type_object?.source) && (
                              <a href={getEntityUrl(work.type_object?.id, work.type_object?.source)!} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-600">
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                      {work.location && (
                        <div>
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.place')}</span>
                          <div className="flex items-center gap-1">
                            <p className="text-gray-900">{getLabel(work.location, lang)}</p>
                            {getEntityUrl(work.location_object?.id, work.location_object?.source) && (
                              <a href={getEntityUrl(work.location_object?.id, work.location_object?.source)!} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-600">
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                      {work.publisher && (
                        <div>
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.printer')}</span>
                          <div className="flex items-center gap-1">
                            <p className="text-gray-900 truncate">{getLabel(work.publisher, lang)}</p>
                            {getEntityUrl(work.publisher_object?.id, work.publisher_object?.source) && (
                              <a href={getEntityUrl(work.publisher_object?.id, work.publisher_object?.source)!} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-600 shrink-0">
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Žanr */}
                    {work.genre && (
                      <div className="pt-3 border-t border-gray-100">
                        <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1.5">{t('metadata.genre')}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="flex items-center gap-1 text-sm font-medium px-2 py-0.5 rounded bg-primary-50 text-primary-700">
                            <Bookmark size={12} className="fill-primary-200" />
                            {getLabel(work.genre_object || work.genre, lang)}
                          </span>
                          {(() => {
                            const genreObj = Array.isArray(work.genre_object) ? work.genre_object[0] : work.genre_object;
                            const url = getEntityUrl(genreObj?.id, genreObj?.source);
                            return url && (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-600">
                                <ExternalLink size={11} />
                              </a>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Kollektsioon */}
                    {work.collection && collections[work.collection] && (() => {
                      const hierarchyIds = getCollectionHierarchy(collections, work.collection);
                      return (
                        <div className="pt-3 border-t border-gray-100">
                          <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1.5">{t('metadata.collection')}</span>
                          <div className="flex items-center gap-2">
                            <FolderOpen size={14} className="text-gray-400 shrink-0" />
                            <div className="flex flex-wrap items-center gap-1 text-sm">
                              {hierarchyIds.map((colId, idx, arr) => {
                                const col = collections[colId];
                                const colorClasses = getCollectionColorClasses(col);
                                const name = col?.name[lang] || col?.name.et || colId;
                                const isLast = idx === arr.length - 1;
                                return (
                                  <React.Fragment key={colId}>
                                    {idx > 0 && <span className="text-gray-300 select-none">›</span>}
                                    <span className={isLast ? `${colorClasses.bg} ${colorClasses.text} px-1.5 py-0.5 rounded font-medium` : 'text-gray-500'}>
                                      {name}
                                    </span>
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ESTER link */}
                    {work.ester_id && (
                      <div className="pt-3 border-t border-gray-100">
                        <a
                          href={`https://www.ester.ee/record=${work.ester_id}*est`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-800"
                        >
                          <ExternalLink size={14} />
                          {t('info.viewInEster')}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Teose märksõnad */}
                {work && ((work.tags && work.tags.length > 0) || (work.tags_object && work.tags_object.length > 0)) && (
                  <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-3 text-gray-800 border-b border-gray-100 pb-2">
                      <BookOpen size={16} className="text-green-600" />
                      <h4 className="font-bold text-sm">{t('metadata.tags')}</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(work.tags_object && work.tags_object.length > 0 ? work.tags_object : work.tags).map((tag, idx) => {
                        const label = getLabel(tag, lang);
                        const tagId = typeof tag !== 'string' ? (tag as any).id : null;
                        return (
                          <span key={idx} className="inline-flex items-center bg-green-50 border border-green-100 rounded-full px-2.5 py-1 text-sm text-green-800">
                            {label}
                            {getEntityUrl(tagId, typeof tag !== 'string' ? (tag as any).source : undefined) && (
                              <a
                                href={getEntityUrl(tagId, typeof tag !== 'string' ? (tag as any).source : undefined)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-1 text-green-600 hover:text-green-800"
                                title={tagId || ''}
                              >
                                <ExternalLink size={10} />
                              </a>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                {t('common:labels.loading')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceMobileView;
