import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { BookDown, BookOpen, Bookmark, Download, ExternalLink, FileSliders, FolderOpen, IdCard, StickyNote, User } from 'lucide-react';
import DownloadModal from '../DownloadModal';
import type { ArchiveRef, Work } from '../../types';
import { FILE_API_URL } from '../../config';
import { useCollection } from '../../contexts/CollectionContext';
import { getCollectionColorClasses, getCollectionHierarchy } from '../../services/collectionService';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import { getEntityUrl } from '../../utils/entityUrl';
import { getLabel } from '../../utils/metadataUtils';
import { isQCode } from '../../utils/qcodeUtils';
import { formatYearDisplay } from '../../utils/yearDisplayUtils';

interface WorkInfoPanelProps {
  work?: Work;
  lang: string;
  onOpenMetaModal?: () => void;
}

const WorkInfoPanel: React.FC<WorkInfoPanelProps> = ({ work, lang, onOpenMetaModal }) => {
  const { t } = useTranslation(['workspace', 'common', 'dashboard']);
  const navigate = useNavigate();
  const { collections } = useCollection();
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [archives, setArchives] = useState<Record<string, { name: string; url?: string }>>({});

  // Arhiivide register (nimed kuvamiseks).
  useEffect(() => {
    fetchWithTimeout(`${FILE_API_URL}/config/archives`)
      .then(r => r.json())
      .then(d => { if (d.archives) setArchives(d.archives); })
      .catch(() => {});
  }, []);

  return (
    <>
      {work && <DownloadModal isOpen={showDownloadModal} workId={work.work_id} onClose={() => setShowDownloadModal(false)} />}

      {/* Work Info */}
      {work && (
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
          <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
            <BookOpen size={18} className="text-primary-600" />
            <h4 className="font-bold">{t('info.workInfo')}</h4>
            <button
              onClick={() => setShowDownloadModal(true)}
              className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded text-gray-500 hover:text-primary-700 hover:bg-primary-50 border border-gray-200 hover:border-primary-200 transition-colors"
              title={t('download.button')}
            >
              <Download size={12} />
              {t('download.button')}
            </button>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.workTitle')}</span>
              <p className="text-gray-900 font-medium">{work.title}</p>
            </div>

            {/* Isikud: v2 creators[] */}
            {work.creators && work.creators.length > 0 && (
              <div>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-2">{t('metadata.creators')}</span>
                <div className="space-y-1.5">
                  {work.creators.map((creator, idx) => {
                    const roleLabel = t(`metadata.roles.${creator.role}`, { defaultValue: creator.role });
                    const dashboardParam = creator.role === 'respondens' ? 'respondens' : 'author';
                    const hasProsopoId = creator.id?.startsWith('vutt:P');

                    return (
                      <div key={idx} className="flex items-center gap-2 group">
                        <div className="flex items-center gap-1.5 text-gray-900">
                          <User size={14} className="text-gray-400 shrink-0" />
                          {hasProsopoId ? (
                            <Link
                              to={`/persons/${creator.id}`}
                              className="font-medium hover:text-primary-600 transition-colors"
                              title={t('dashboard:workCard.viewPerson', 'Vaata isiku lehte')}
                            >
                              {creator.name}
                            </Link>
                          ) : (
                            <span
                              className="font-medium select-text cursor-pointer hover:text-primary-600 transition-colors"
                              onClick={() => navigate(`/?${dashboardParam}=${encodeURIComponent(creator.name)}`)}
                            >
                              {creator.name}
                            </span>
                          )}
                        </div>
                        {!hasProsopoId && getEntityUrl(creator.id, creator.source) ? (
                          <a
                            href={getEntityUrl(creator.id, creator.source)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                            title={creator.id || ''}
                          >
                            <ExternalLink size={12} />
                          </a>
                        ) : null}
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{roleLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Aasta, Trükikoht, Trükkal, Žanr, Tüüp */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.year')}</span>
                <p className="text-gray-900">{formatYearDisplay(work.year_display, work.year, t)}</p>
              </div>
              
              {/* Tüüp */}
              {work.type && (
                <div>
                  <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.type')}</span>
                  <div className="flex items-center gap-1.5">
                    <p className="text-gray-900">{getLabel(work.type, lang)}</p>
                    {getEntityUrl((work.type as any)?.id, (work.type as any)?.source) && (
                      <a
                        href={getEntityUrl((work.type as any)?.id, (work.type as any)?.source)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                        title={(work.type as any)?.id || ''}
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {work.location && (
                <div>
                  <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.place')}</span>
                  <div className="flex items-center gap-1.5">
                    <p className="text-gray-900">{getLabel(work.location, lang)}</p>
                    {getEntityUrl((work.location as any)?.id, (work.location as any)?.source) && (
                      <a
                        href={getEntityUrl((work.location as any)?.id, (work.location as any)?.source)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                        title={(work.location as any)?.id || ''}
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              )}
              
              {work.publisher && (
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.printer')}</span>
                  <div className="flex items-center gap-1.5 group">
                    <div className="flex items-center gap-1.5 text-gray-900 overflow-hidden">
                      {(() => {
                        const pubId = (work.publisher as any)?.id;
                        const hasProsopoId = pubId?.startsWith('vutt:P');
                        if (hasProsopoId) {
                          return (
                            <>
                              <Link
                                to={`/persons/${pubId}`}
                                className="text-gray-400 hover:text-primary-600 transition-colors shrink-0"
                                title={t('dashboard:workCard.viewPerson', 'Vaata isiku lehte')}
                              >
                                <IdCard size={14} />
                              </Link>
                              <Link
                                to={`/persons/${pubId}`}
                                className="truncate hover:text-primary-600 transition-colors"
                                title={t('dashboard:workCard.viewPerson', 'Vaata isiku lehte')}
                              >
                                {getLabel(work.publisher, lang)}
                              </Link>
                            </>
                          );
                        }
                        return (
                          <>
                            <button
                              onClick={() => navigate(`/?printer=${encodeURIComponent(pubId && isQCode(pubId) ? pubId : getLabel(work.publisher, lang))}`)}
                              className="text-gray-400 hover:text-amber-600 transition-colors shrink-0"
                              title="Filtreeri trükkali järgi"
                            >
                              <BookDown size={14} />
                            </button>
                            <span
                              className="truncate select-text cursor-pointer hover:text-amber-600 transition-colors"
                              onClick={() => navigate(`/?printer=${encodeURIComponent(pubId && isQCode(pubId) ? pubId : getLabel(work.publisher, lang))}`)}
                            >
                              {getLabel(work.publisher, lang)}
                            </span>
                          </>
                        );
                      })()}
                    </div>
                    {getEntityUrl((work.publisher as any)?.id, (work.publisher as any)?.source) && (
                      <a
                        href={getEntityUrl((work.publisher as any)?.id, (work.publisher as any)?.source)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors shrink-0"
                        title={(work.publisher as any)?.id || ''}
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Žanrid - eraldi sektsioon */}
            {(() => {
              const raw = work.genre;
              const genres: any[] = Array.isArray(raw) ? raw : (raw ? [raw] : []);
              if (genres.length === 0) return null;
              return (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1.5">{t('metadata.genre')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {genres.map((g, i) => {
                      const label = getLabel(g, lang);
                      const genreObj = typeof g === 'object' ? g : null;
                      const url = genreObj ? getEntityUrl(genreObj.id, genreObj.source) : null;
                      return (
                        <div key={i} className="flex items-center gap-1">
                          <button
                            onClick={() => navigate(`/?genre=${encodeURIComponent(label)}`)}
                            className="flex items-center gap-1 text-sm font-medium px-2 py-0.5 rounded bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors"
                            title={t('dashboard:workCard.filterByGenre', { genre: label })}
                          >
                            <Bookmark size={12} className="fill-violet-200" />
                            {label}
                          </button>
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                              title={genreObj?.id || ''}
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Kollektsioonid */}
            {(work.collections || []).some(cid => collections[cid]) && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1.5">{t('metadata.collection')}</span>
                <div className="flex flex-col gap-2">
                  {(work.collections || []).filter(cid => collections[cid]).map(rootId => {
                    const hierarchyIds = getCollectionHierarchy(collections, rootId);
                    return (
                      <div key={rootId} className="flex items-center gap-2">
                        <FolderOpen size={14} className="text-gray-400 shrink-0" />
                        <div className="flex flex-wrap items-center gap-1 text-sm">
                          {hierarchyIds.map((colId, idx, arr) => {
                            const col = collections[colId];
                            const colorClasses = getCollectionColorClasses(col);
                            const name = col?.name[lang as 'et' | 'en'] || col?.name.et || colId;
                            const isLast = idx === arr.length - 1;
                            const isVirtualGroup = col?.type === 'virtual_group';
                            return (
                              <React.Fragment key={colId}>
                                {idx > 0 && <span className="text-gray-300 select-none">›</span>}
                                <span
                                  onClick={() => !isVirtualGroup && navigate(`/?collection=${encodeURIComponent(colId)}`)}
                                  className={`${isLast ? `${colorClasses.bg} ${colorClasses.text} ${colorClasses.hoverBg} px-1.5 py-0.5 rounded font-medium cursor-pointer` : 'text-gray-500 hover:text-gray-700'} transition-colors ${isVirtualGroup ? 'cursor-default' : 'cursor-pointer'}`}
                                  title={isVirtualGroup ? name : t('dashboard:workCard.filterByCollection', 'Filtreeri selle kollektsiooni järgi')}
                                >
                                  {name}
                                </span>
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Arhiiviviited */}
            {work.archive_refs && work.archive_refs.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">{t('info.archiveRefs', 'Arhiiviviited')}</p>
                <div className="space-y-1.5">
                  {work.archive_refs.map((ref: ArchiveRef, idx: number) => {
                    const archiveName = archives[ref.archive_id]?.name;
                    const archiveUrl = archives[ref.archive_id]?.url;
                    const isValidUrl = (url: string) => /^https?:\/\//.test(url);
                    return (
                      <div key={idx} className="text-sm text-gray-700">
                        <span className="font-medium text-gray-800">
                          {ref.archive_id}
                          {archiveName && <span className="font-normal text-gray-500"> — {archiveName}</span>}
                        </span>
                        {ref.reference && <span className="ml-1">{ref.reference}</span>}
                        {ref.url && isValidUrl(ref.url) ? (
                          <a href={ref.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary-600 hover:text-primary-800" title={ref.url}>↗</a>
                        ) : archiveUrl && isValidUrl(archiveUrl) ? (
                          <a href={archiveUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-gray-400 hover:text-gray-600" title={archiveUrl}>↗</a>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Teose märkused */}
            {work.notes && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <StickyNote size={12} />
                  {t('metadata.notes', 'Märkused')}
                </span>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{work.notes}</p>
              </div>
            )}

            {/* Links and Actions */}
            <div className="mt-4 pt-3 border-t border-gray-100 space-y-3">
              {work.ester_id && (
                <a
                  href={`https://www.ester.ee/record=${work.ester_id}*est`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-800 hover:underline"
                  title="Ava ESTER-i kirje"
                >
                  <ExternalLink size={16} />
                  {t('info.viewInEster')}
                </a>
              )}
              {work.external_url && /^https?:\/\//.test(work.external_url) && (
                <a
                  href={work.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-800 hover:underline"
                  title={work.external_url}
                >
                  <ExternalLink size={16} />
                  {t('info.viewExternal')}
                </a>
              )}


              {onOpenMetaModal && (
                <button
                  onClick={onOpenMetaModal}
                  className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-800 hover:underline"
                  title="Muuda teose metaandmeid"
                >
                  <FileSliders size={16} />
                  {t('metadata.editMetadata')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}


    </>
  );
};

export default WorkInfoPanel;
