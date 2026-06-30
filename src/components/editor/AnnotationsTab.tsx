import React, { useState, useEffect } from 'react';
import { isAtLeast } from '../../utils/roleUtils';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { BookOpen, User, ExternalLink, Download, Edit3, Tag, Search, X, MessageSquare, Trash2, FolderOpen, Bookmark, Check, BookDown, IdCard, SquarePen, FileSliders, Reply, Send, StickyNote, History as HistoryIcon } from 'lucide-react';
import DownloadModal from '../DownloadModal';
import { Work, Page, Annotation, ArchiveRef } from '../../types';
import type { TextAnnotation } from '../../types';
import { extractHighlightedText } from '../../utils/annUtils';
import { LinkedEntity } from '../../types/LinkedEntity';
import { getLabel } from '../../utils/metadataUtils';
import { getEntityUrl } from '../../utils/entityUrl';
import { getAllTags } from '../../services/searchService';
import { isQCode } from '../../utils/qcodeUtils';
import EntityPicker from '../EntityPicker';
import { FILE_API_URL } from '../../config';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { useCollection } from '../../contexts/CollectionContext';
import { useMeiliIndex } from '../../contexts/MeilisearchContext';
import { getCollectionColorClasses, getCollectionHierarchy } from '../../services/collectionService';
import { formatYearDisplay } from '../../utils/yearDisplayUtils';
import { fetchCommentHistory, restoreComment, CommentHistory } from '../../services/commentHistoryService';
import MarkdownEditor from '../MarkdownEditor';
import MarkdownView from '../MarkdownView';

interface AnnotationsTabProps {
  work?: Work;
  page: Page;
  page_tags: (string | LinkedEntity)[];
  setPageTags: (tags: (string | LinkedEntity)[]) => void;
  comments: Annotation[];
  setComments: (comments: Annotation[]) => void;
  onSaveAnnotations?: (comments: Annotation[]) => Promise<void>;
  // Kommentaarid on serveris juba salvestatud (restore-endpoint commitis) — sünkroni
  // ainult lokaalne + salvestatud baasseis, ÄRA tee teist /save commitit.
  onCommentsRestored?: (comments: Annotation[]) => void;
  onReplyToComment?: (commentId: string, replyText: string) => Promise<void>;
  readOnly: boolean;
  user: any;
  authToken: string | null;
  onOpenMetaModal?: () => void;
  lang: string;
  textAnnotations: TextAnnotation[];
  textContent: string;
  onSaveTextAnnotations: (updated: TextAnnotation[]) => Promise<void>;
  onDeleteTextAnnotation: (annId: number) => Promise<void>;
}

const AnnotationsTab: React.FC<AnnotationsTabProps> = ({
  work,
  page: _page,
  page_tags,
  setPageTags,
  comments,
  setComments,
  onSaveAnnotations,
  onCommentsRestored,
  onReplyToComment,
  readOnly,
  user,
  authToken,
  onOpenMetaModal,
  lang,
  textAnnotations,
  textContent,
  onSaveTextAnnotations,
  onDeleteTextAnnotation,
}) => {
  const { t } = useTranslation(['workspace', 'common', 'dashboard']);
  const navigate = useNavigate();
  const location = useLocation();
  const { collections } = useCollection();
  const index = useMeiliIndex();
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [editingAnnId, setEditingAnnId] = useState<number | null>(null);
  const [editingAnnText, setEditingAnnText] = useState('');
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [savingReplyId, setSavingReplyId] = useState<string | null>(null);
  const [commentHistory, setCommentHistory] = useState<CommentHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
  const [deletedCardOpen, setDeletedCardOpen] = useState(false);
  const highlightedCommentId = new URLSearchParams(location.search).get('comment');

  const isAdmin = isAtLeast(user?.role, 'admin');
  const canRestore = isAtLeast(user?.role, 'editor');
  
  // Arhiivide register (nimed kuvamiseks)
  const [archives, setArchives] = useState<Record<string, { name: string; url?: string }>>({});
  useEffect(() => {
    fetchWithTimeout(`${FILE_API_URL}/config/archives`)
      .then(r => r.json())
      .then(d => { if (d.archives) setArchives(d.archives); })
      .catch(() => {});
  }, []);

  // Sõnavara soovitused lehekülje märksõnadele (serverist)
  const [tagSuggestions, setTagSuggestions] = useState<{ label: string; id: string | null }[]>([]);
  // Meilisearchi märksõnad (kõik olemasolevad, koos ID-dega)
  const [allAvailableTags, setAllAvailableTags] = useState<{ label: string; id: string | null }[]>([]);

  // Lae soovitused serverist
  useEffect(() => {
    const fetchTags = async () => {
      if (!authToken) return;
      try {
        const response = await fetchWithTimeout(`${FILE_API_URL}/get-metadata-suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
          body: JSON.stringify({ lang })
        });
        const data = await response.json();
        if (data.status === 'success') {
          setTagSuggestions(data.tags || []);
        }
      } catch (e) {
        console.error("Viga märksõnade laadimisel", e);
      }
    };
    fetchTags();
  }, [authToken, lang]);

  useEffect(() => {
    if (!highlightedCommentId) return;
    const el = document.getElementById(`comment-${highlightedCommentId}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightedCommentId, comments]);

  // Lae kõik olemasolevad märksõnad Meilisearchist
  useEffect(() => {
    if (!index) return;
    const loadTags = async () => {
      const fetchedTags = await getAllTags(index, lang);
      setAllAvailableTags(fetchedTags);
    };
    loadTags();
  }, [lang, index]);

  // Ühenda serveri soovitused ja Meilisearchi märksõnad
  const mergedTagSuggestions = React.useMemo(() => {
    // Ühenda ja eemalda duplikaadid (labeli JA ID järgi)
    // Eelistame serveri omasid (tagSuggestions), siis Meilisearchi omasid (allAvailableTags)
    const combined = [...tagSuggestions, ...allAvailableTags];
    const uniqueByLabel = new Map();
    const seenIds = new Set<string>();  // Jälgi nähtud Wikidata ID-sid

    combined.forEach(item => {
      // Kui see ID on juba nähtud, jäta vahele (vältimaks duplikaate eri labelitega)
      if (item.id && seenIds.has(item.id)) {
        return;
      }
      if (item.id) {
        seenIds.add(item.id);
      }

      // Võti on label väiketähtedega
      const key = item.label.toLowerCase();
      const existing = uniqueByLabel.get(key);

      if (!existing) {
        uniqueByLabel.set(key, item);
      } else if (!existing.id && item.id) {
        // Kui olemasoleval pole ID-d, aga uuel on, asenda (rikasta)
        uniqueByLabel.set(key, item);
      }
    });

    return Array.from(uniqueByLabel.values()).sort((a, b) => a.label.localeCompare(b.label, lang));
  }, [tagSuggestions, allAvailableTags, lang]);

  const removeTag = (tagToRemove: string) => {
    // Eemalda sildi järgi
    setPageTags(page_tags.filter(t => getLabel(t, lang).toLowerCase() !== tagToRemove.toLowerCase()));
  };

  const addComment = async () => {
    if (!newComment.trim()) return;
    const comment: Annotation = {
      id: Date.now().toString(),
      text: newComment,
      author: user?.name || 'Anonüümne',
      author_username: user?.username,
      created_at: new Date().toISOString()
    };
    const updated = [...comments, comment];
    setComments(updated);
    setNewComment('');
    if (onSaveAnnotations) await onSaveAnnotations(updated);
  };

  const removeComment = (commentId: string) => {
    if (!window.confirm(t('info.deleteCommentConfirm'))) return;
    setComments(comments.filter(c => c.id !== commentId));
  };

  const startEditComment = (comment: Annotation) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.text);
  };

  const saveEditComment = async (commentId: string) => {
    if (!editingText.trim()) return;
    const updated = comments.map(c => c.id === commentId ? { ...c, text: editingText } : c);
    setComments(updated);
    setEditingCommentId(null);
    setEditingText('');
    if (onSaveAnnotations) await onSaveAnnotations(updated);
  };

  const saveReply = async (commentId: string) => {
    if (!replyText.trim() || !onReplyToComment) return;
    setReplyError(null);
    setSavingReplyId(commentId);
    try {
      await onReplyToComment(commentId, replyText.trim());
      setReplyText('');
      setReplyingToCommentId(null);
    } catch (e: any) {
      setReplyError(e.message || t('common:errors.unknownError'));
    } finally {
      setSavingReplyId(null);
    }
  };

  const ensureHistory = async () => {
    if (commentHistory || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setCommentHistory(await fetchCommentHistory(_page, authToken || undefined));
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  };

  const doRestore = async (
    mode: 'version' | 'deleted', commentId: string, commitHash: string,
  ) => {
    try {
      const updated = await restoreComment(
        _page, { mode, comment_id: commentId, commit_hash: commitHash }, authToken || undefined,
      );
      // Restore-endpoint juba committis kettale — sünkroni ainult seis, ilma teise salvestuseta.
      if (onCommentsRestored) onCommentsRestored(updated);
      else setComments(updated);
      setCommentHistory(null);
      setOpenHistoryId(null);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : t('info.restoreError'));
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 p-6 overflow-y-auto">

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

      {/* Genre / Teose märksõnad */}
      {work && work.tags && work.tags.length > 0 && (
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
      )}

      {/* Tekst-annotatsioonid */}
      {textAnnotations.length > 0 && (
        <div className="bg-white p-5 rounded-lg border border-yellow-200 shadow-sm mb-6">
          <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
            <SquarePen size={16} className="text-yellow-500" />
            <h4 className="font-bold">{t('annotations.textAnnotations', 'Tekst-annotatsioonid')}</h4>
          </div>
          <div className="space-y-3">
            {textAnnotations.map(ann => {
              const highlightedText = extractHighlightedText(textContent, ann.id);
              return (
                <div key={ann.id} className="bg-gray-50 p-3 rounded-lg border border-gray-100 relative group">
                  {editingAnnId === ann.id ? (
                    <div className="space-y-2">
                      {highlightedText && (
                        <p className="text-xs text-gray-500 italic line-clamp-2">„{highlightedText}"</p>
                      )}
                      <textarea
                        autoFocus
                        className="w-full px-2 py-1.5 text-sm border border-primary-300 rounded focus:border-primary-500 focus:ring-1 focus:ring-primary-200 outline-none resize-y"
                        rows={3}
                        value={editingAnnText}
                        onChange={e => setEditingAnnText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') setEditingAnnId(null); }}
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setEditingAnnId(null)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                        >
                          <X size={12} />
                          {t('info.cancelEdit')}
                        </button>
                        <button
                          type="button"
                          disabled={!editingAnnText.trim()}
                          onClick={async () => {
                            const updated = textAnnotations.map(a =>
                              a.id === ann.id ? { ...a, comment: editingAnnText } : a
                            );
                            await onSaveTextAnnotations(updated);
                            setEditingAnnId(null);
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 transition-colors"
                        >
                          <Check size={12} />
                          {t('info.saveEdit')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {highlightedText ? (
                        <p className="text-xs text-gray-500 italic mb-1.5 line-clamp-2">„{highlightedText}"</p>
                      ) : (
                        <p className="text-xs text-amber-600 italic mb-1.5">
                          {t('annotations.anchorMissing', 'Seotud tekstilõiku ei leitud')}
                        </p>
                      )}
                      <p className="text-gray-800 text-sm mb-2 leading-relaxed pr-5">{ann.comment}</p>
                      <div className="flex justify-between items-center text-xs text-gray-500">
                        <span className="font-semibold text-primary-700">{ann.author}</span>
                        <span>{new Date(ann.created_at).toLocaleString('et-EE')}</span>
                      </div>
                      {!readOnly && (
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => { setEditingAnnId(ann.id); setEditingAnnText(ann.comment); }}
                            className="text-gray-400 hover:text-primary-600 p-1 rounded hover:bg-white transition-colors"
                            title={t('info.editComment')}
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTextAnnotation(ann.id)}
                            className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-white transition-colors"
                            title={t('info.deleteComment')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tags */}
      <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
        <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
          <Tag size={18} className="text-primary-600" />
          <h4 className="font-bold">{t('workspace:info.pageTags')}</h4>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {page_tags.length === 0 && <span className="text-sm text-gray-400 italic">{t('info.noTags')}</span>}
          {page_tags.map((tag, idx) => {
            const label = getLabel(tag, lang);
            const tagId = typeof tag !== 'string' ? (tag as any).id : null;
            const isPersonTag = tagId?.startsWith('vutt:P');

            if (isPersonTag) {
              return (
                <span key={idx} className="inline-flex items-center rounded-full bg-primary-50 border border-primary-200 text-sm text-primary-700 overflow-hidden">
                  <Link
                    to={`/persons/${tagId}`}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 hover:text-primary-600 transition-colors"
                    title={t('dashboard:workCard.viewPerson', 'Vaata isiku lehte')}
                  >
                    <User size={12} className="opacity-60" />
                    {label}
                  </Link>
                  {!readOnly && (
                    <button
                      onClick={() => removeTag(label)}
                      className="pr-2 pl-1 py-1 text-primary-400 hover:text-red-500 border-l border-primary-100"
                    >
                      <X size={14} />
                    </button>
                  )}
                </span>
              );
            }

            return (
              <span key={idx} className="inline-flex items-center rounded-full bg-primary-50 border border-primary-100 text-sm text-primary-800 group overflow-hidden">
                <button
                  onClick={() => tagId
                    ? navigate(`/search?pageTags=${encodeURIComponent(tagId)}`, { state: { pageTagsLabels: { [tagId]: label } } })
                    : navigate(`/search?q=${encodeURIComponent(label)}&scope=annotation`)}
                  className="pl-2.5 pr-1.5 py-1 hover:text-primary-600 flex items-center gap-1"
                  title="Otsi seda märksõna kogu korpusest"
                >
                  {label}
                  <Search size={12} className="opacity-0 group-hover:opacity-50" />
                </button>

                {getEntityUrl(tagId, typeof tag !== 'string' ? (tag as any).source : undefined) && (
                  <a
                    href={getEntityUrl(tagId, typeof tag !== 'string' ? (tag as any).source : undefined)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-1 text-primary-400 hover:text-blue-600 border-l border-primary-100 transition-colors"
                    title={tagId || ''}
                  >
                    <ExternalLink size={10} />
                  </a>
                )}

                {!readOnly && (
                  <button
                    onClick={() => removeTag(label)}
                    className={`pr-2 pl-1 py-1 text-primary-400 hover:text-red-500 ${tagId ? 'border-l border-primary-100' : ''}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {!readOnly && (
          <div className="relative">
            <EntityPicker
              type="topic"
              showPersonToggle={true}
              token={authToken ?? undefined}
              value={null}
              onChange={(val) => {
                if (val) {
                  // Lisa märksõna kui teda pole veel listis
                  const label = val.label.toLowerCase();
                  const exists = page_tags.some(t => getLabel(t, lang).toLowerCase() === label);
                  if (!exists) {
                    setPageTags([...page_tags, val]);
                  }
                }
              }}
              placeholder={t('workspace:metadata.tagsPlaceholder')}
              lang={lang}
              localSuggestions={mergedTagSuggestions}
            />
          </div>
        )}
      </div>

      {/* Comments */}
      <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
          <MessageSquare size={18} className="text-primary-600" />
          <h4 className="font-bold">{t('workspace:info.pageAnnotations')}</h4>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 mb-4 min-h-[100px]">
          {comments.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <p className="text-sm italic">{t('info.noAnnotationsHint')}</p>
            </div>
          )}
          {comments.map(comment => (
            <div
              id={`comment-${comment.id}`}
              key={comment.id}
              className={`bg-gray-50 p-3 rounded-lg border relative group ${
                highlightedCommentId === comment.id ? 'border-primary-300 ring-2 ring-primary-100' : 'border-gray-100'
              }`}
            >
              {editingCommentId === comment.id ? (
                <div className="space-y-2">
                  <MarkdownEditor
                    value={editingText}
                    onChange={setEditingText}
                    minRows={6}
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setEditingCommentId(null); setEditingText(''); }}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                    >
                      <X size={12} />
                      {t('info.cancelEdit')}
                    </button>
                    <button
                      onClick={() => saveEditComment(comment.id)}
                      disabled={!editingText.trim()}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 transition-colors"
                    >
                      <Check size={12} />
                      {t('info.saveEdit')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-gray-800 text-sm mb-2 leading-relaxed pr-5 vutt-md-comment">
                    <MarkdownView content={comment.text} softBreaks />
                  </div>
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <span className="font-semibold text-primary-700">{comment.author}</span>
                    <span>{new Date(comment.created_at).toLocaleString('et-EE')}</span>
                  </div>
                  {(comment.replies || []).length > 0 && (
                    <div className="mt-3 space-y-2 border-l-2 border-primary-100 pl-3">
                      {(comment.replies || []).map(reply => (
                        <div key={reply.id} className="bg-white border border-gray-100 rounded-md px-3 py-2">
                          <div className="text-gray-800 text-sm mb-1 leading-relaxed vutt-md-comment">
                            <MarkdownView content={reply.text} softBreaks />
                          </div>
                          <div className="flex justify-between items-center text-xs text-gray-500">
                            <span className="font-semibold text-primary-700">{reply.author}</span>
                            <span>{new Date(reply.created_at).toLocaleString('et-EE')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {replyingToCommentId === comment.id && (
                    <div className="mt-3 space-y-2">
                      <MarkdownEditor
                        value={replyText}
                        onChange={setReplyText}
                        placeholder={t('info.replyPlaceholder')}
                        minRows={3}
                      />
                      {replyError && <p className="text-xs text-red-600">{replyError}</p>}
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => { setReplyingToCommentId(null); setReplyText(''); setReplyError(null); }}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                        >
                          <X size={12} />
                          {t('info.cancelEdit')}
                        </button>
                        <button
                          onClick={() => saveReply(comment.id)}
                          disabled={!replyText.trim() || savingReplyId === comment.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 transition-colors"
                        >
                          <Send size={12} />
                          {t('info.sendReply')}
                        </button>
                      </div>
                    </div>
                  )}
                  {openHistoryId === comment.id && (
                    <div className="mt-3 border-t border-gray-200 pt-2 space-y-2">
                      {historyLoading && <p className="text-xs text-gray-400">…</p>}
                      {historyError && <p className="text-xs text-red-600">{historyError}</p>}
                      {!historyLoading && (commentHistory?.versions[comment.id]?.length ? (
                        commentHistory.versions[comment.id].map(v => (
                          <div key={v.commit_hash} className="bg-white border border-gray-100 rounded px-2 py-1.5">
                            <div className="vutt-md-comment text-sm text-gray-700">
                              <MarkdownView content={v.text} softBreaks />
                            </div>
                            <div className="flex justify-between items-center text-xs text-gray-400 mt-1">
                              <span>{v.author} · {new Date(v.timestamp).toLocaleString('et-EE')}</span>
                              <button
                                onClick={() => doRestore('version', comment.id, v.commit_hash)}
                                className="text-primary-600 hover:text-primary-800 font-medium"
                              >
                                {t('info.restoreText')}
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-gray-400 italic">{t('info.noOlderVersions')}</p>
                      ))}
                    </div>
                  )}
                  {!readOnly && (
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onReplyToComment && (
                        <button
                          onClick={() => {
                            setReplyingToCommentId(comment.id);
                            setReplyText('');
                            setReplyError(null);
                          }}
                          className="text-gray-400 hover:text-primary-600 p-1 rounded hover:bg-white transition-colors"
                          title={t('info.replyToComment')}
                        >
                          <Reply size={14} />
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => startEditComment(comment)}
                          className="text-gray-400 hover:text-primary-600 p-1 rounded hover:bg-white transition-colors"
                          title={t('info.editComment')}
                        >
                          <Edit3 size={14} />
                        </button>
                      )}
                      {canRestore && (
                        <button
                          onClick={async () => {
                            await ensureHistory();
                            setOpenHistoryId(openHistoryId === comment.id ? null : comment.id);
                          }}
                          className="text-gray-400 hover:text-primary-600 p-1 rounded hover:bg-white transition-colors"
                          title={t('info.commentHistory')}
                        >
                          <HistoryIcon size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => removeComment(comment.id)}
                        className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-white transition-colors"
                        title={t('info.deleteComment')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {canRestore && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <button
              onClick={async () => {
                await ensureHistory();
                setDeletedCardOpen(o => !o);
              }}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              <Trash2 size={13} />
              {t('info.deletedComments')}
              {commentHistory && ` (${commentHistory.deleted.length})`}
            </button>
            {deletedCardOpen && (
              <div className="mt-2 space-y-2">
                {historyLoading && <p className="text-xs text-gray-400">…</p>}
                {historyError && <p className="text-xs text-red-600">{historyError}</p>}
                {!historyLoading && commentHistory && (
                  commentHistory.deleted.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">{t('info.noDeletedComments')}</p>
                  ) : (
                    <>
                      {commentHistory.deleted.map(d => (
                        <div key={d.id} className="bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
                          <div className="vutt-md-comment text-sm text-gray-700">
                            <MarkdownView content={d.text} softBreaks />
                          </div>
                          <div className="flex justify-between items-center text-xs text-gray-400 mt-1">
                            <span>{d.author} · {new Date(d.created_at).toLocaleString('et-EE')}</span>
                            <button
                              onClick={() => doRestore('deleted', d.id, d.last_seen_commit)}
                              className="text-primary-600 hover:text-primary-800 font-medium"
                            >
                              {t('info.restoreComment')}
                            </button>
                          </div>
                        </div>
                      ))}
                      {commentHistory.truncated && (
                        <p className="text-xs text-gray-400 italic">{t('info.historyTruncated')}</p>
                      )}
                    </>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {!readOnly ? (
          <div className="mt-auto">
            <MarkdownEditor
              value={newComment}
              onChange={setNewComment}
              placeholder={t('info.commentPlaceholder')}
              minRows={5}
            />
            <button
              onClick={addComment}
              disabled={!newComment.trim()}
              className="w-full py-2 bg-gray-900 text-white text-xs font-bold uppercase tracking-wider rounded hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {t('info.addComment').toUpperCase()}
            </button>
          </div>
        ) : (
          <div className="mt-auto text-center py-4 text-sm text-gray-400">
            {t('info.loginToComment')}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnnotationsTab;
