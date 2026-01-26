import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BookOpen, User, ExternalLink, Download, Edit3, Tag, Search, X, MessageSquare, Trash2 } from 'lucide-react';
import { Work, Page, Annotation, Creator } from '../../types';
import { getLabel } from '../../utils/metadataUtils';
import { getWorkFullText, getAllTags } from '../../services/meiliService';
import EntityPicker from '../EntityPicker';
import { FILE_API_URL } from '../../config';

interface AnnotationsTabProps {
  work?: Work;
  page: Page;
  page_tags: (string | any)[];
  setPageTags: (tags: (string | any)[]) => void;
  comments: Annotation[];
  setComments: (comments: Annotation[]) => void;
  readOnly: boolean;
  user: any;
  authToken: string | null;
  onOpenMetaModal?: () => void;
  lang: string;
}

const AnnotationsTab: React.FC<AnnotationsTabProps> = ({ 
  work,
  page,
  page_tags,
  setPageTags,
  comments,
  setComments,
  readOnly,
  user,
  authToken,
  onOpenMetaModal,
  lang
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const navigate = useNavigate();
  const [newComment, setNewComment] = useState('');
  
  // Sõnavara soovitused lehekülje märksõnadele (serverist)
  const [tagSuggestions, setTagSuggestions] = useState<any[]>([]);
  // Meilisearchi märksõnad (kõik olemasolevad)
  const [allAvailableTags, setAllAvailableTags] = useState<string[]>([]);

  // Lae soovitused serverist
  useEffect(() => {
    const fetchTags = async () => {
      if (!authToken) return;
      try {
        const response = await fetch(`${FILE_API_URL}/get-metadata-suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_token: authToken })
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
  }, [authToken]);

  // Lae kõik olemasolevad märksõnad Meilisearchist
  useEffect(() => {
    const loadTags = async () => {
      // Küsi märksõnu vastavas keeles
      const fetchedTags = await getAllTags(lang);
      // getAllTags tagastab juba sorteeritud ja unikaalsed stringid
      setAllAvailableTags(fetchedTags);
    };
    loadTags();
  }, [lang]); // Uuenda kui keel muutub

  // Ühenda serveri soovitused ja Meilisearchi märksõnad
  const mergedTagSuggestions = React.useMemo(() => {
    // Teisenda stringid SuggestionItem kujule
    const meiliSuggestions = allAvailableTags.map(tag => ({
      label: tag,
      id: null
    }));

    // Ühenda ja eemalda duplikaadid (labeli järgi)
    const combined = [...tagSuggestions, ...meiliSuggestions];
    const unique = new Map();
    
    combined.forEach(item => {
      if (!unique.has(item.label.toLowerCase())) {
        unique.set(item.label.toLowerCase(), item);
      }
    });

    return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label, lang));
  }, [tagSuggestions, allAvailableTags, lang]);

  const removeTag = (tagToRemove: string) => {
    // Eemalda sildi järgi
    setPageTags(page_tags.filter(t => getLabel(t, lang).toLowerCase() !== tagToRemove.toLowerCase()));
  };

  const addComment = () => {
    if (!newComment.trim()) return;
    const comment: Annotation = {
      id: Date.now().toString(),
      text: newComment,
      author: user?.name || 'Anonüümne',
      created_at: new Date().toISOString()
    };
    setComments([...comments, comment]);
    setNewComment('');
  };

  const removeComment = (commentId: string) => {
    setComments(comments.filter(c => c.id !== commentId));
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 p-6 overflow-y-auto">

      {/* Work Info */}
      {work && (
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
          <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
            <BookOpen size={18} className="text-primary-600" />
            <h4 className="font-bold">{t('info.workInfo')}</h4>
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
                    
                    return (
                      <div key={idx} className="flex items-center gap-2 group">
                        <div className="flex items-center gap-1.5 text-gray-900">
                          <button
                            onClick={() => navigate(`/?${dashboardParam}=${encodeURIComponent(creator.name)}`)}
                            className="text-gray-400 hover:text-primary-600 transition-colors"
                            title={t('workCard.searchAuthor', 'Filtreeri dashboardil')}
                          >
                            <User size={14} />
                          </button>
                          <span 
                            className="font-medium select-text cursor-pointer hover:text-primary-600 transition-colors"
                            onClick={() => navigate(`/?${dashboardParam}=${encodeURIComponent(creator.name)}`)}
                          >
                            {creator.name}
                          </span>
                        </div>
                        {creator.id && (
                          <a
                            href={`https://www.wikidata.org/wiki/${creator.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                            title={`Vaata Wikidatas: ${creator.id}`}
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
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
                <p className="text-gray-900">{work.year}</p>
              </div>
              
              {/* Tüüp */}
              {work.type && (
                <div>
                  <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.type')}</span>
                  <div className="flex items-center gap-1.5">
                    <p className="text-gray-900">{getLabel(work.type_object || work.type, lang)}</p>
                    {work.type_object?.id && (
                      <a
                        href={`https://www.wikidata.org/wiki/${work.type_object.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                        title={`Vaata Wikidatas: ${work.type_object.id}`}
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Žanr (üksik) */}
              {work.genre && (
                <div>
                  <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">{t('metadata.genre')}</span>
                  <div className="flex items-center gap-1.5">
                    <p className="text-gray-900">{getLabel(work.genre_object || work.genre, lang)}</p>
                    {(Array.isArray(work.genre_object) ? work.genre_object[0]?.id : work.genre_object?.id) && (
                      <a
                        href={`https://www.wikidata.org/wiki/${Array.isArray(work.genre_object) ? work.genre_object[0].id : work.genre_object?.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                        title="Vaata Wikidatas"
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
                    {work.location_object?.id && (
                      <a
                        href={`https://www.wikidata.org/wiki/${work.location_object.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                        title={`Vaata Wikidatas: ${work.location_object.id}`}
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
                      <button
                        onClick={() => navigate(`/?printer=${encodeURIComponent(getLabel(work.publisher, lang))}`)}
                        className="text-gray-400 hover:text-amber-600 transition-colors shrink-0"
                        title="Filtreeri trükkali järgi"
                      >
                        <User size={14} />
                      </button>
                      <span 
                        className="truncate select-text cursor-pointer hover:text-amber-600 transition-colors"
                        onClick={() => navigate(`/?printer=${encodeURIComponent(getLabel(work.publisher, lang))}`)}
                      >
                        {getLabel(work.publisher, lang)}
                      </span>
                    </div>
                    {work.publisher_object?.id && (
                      <a
                        href={`https://www.wikidata.org/wiki/${work.publisher_object.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors shrink-0"
                        title={`Vaata Wikidatas: ${work.publisher_object.id}`}
                      >
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>

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

              <button
                onClick={async () => {
                  try {
                    const { text, title, author, year } = await getWorkFullText(work.id);
                    // Loome faili sisu päisega
                    const header = `${title}\n${author}${year ? `, ${year}` : ''}\n\n`;
                    const fullContent = header + text;
                    // Genereerime faili ja pakume allalaadimiseks
                    const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${work.id}.txt`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    console.error('Download error:', err);
                    alert('Viga teksti allalaadimisel');
                  }
                }}
                className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-800 hover:underline"
              >
                <Download size={16} />
                {t('metadata.downloadFullText')}
              </button>

              {onOpenMetaModal && (
                <button
                  onClick={onOpenMetaModal}
                  className="flex items-center gap-2 text-sm text-amber-600 hover:text-amber-800 hover:underline"
                  title="Muuda teose metaandmeid"
                >
                  <Edit3 size={16} />
                  {t('metadata.editMetadata')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Genre / Teose märksõnad */}
      {work && ((work.tags && work.tags.length > 0) || (work.tags_object && work.tags_object.length > 0)) && (
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
          <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
            <BookOpen size={18} className="text-green-600" />
            <h4 className="font-bold">{t('metadata.genre')}</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {(work.tags_object && work.tags_object.length > 0 ? work.tags_object : work.tags).map((tag, idx) => {
              const label = getLabel(tag, lang);
              const tagId = typeof tag !== 'string' ? (tag as any).id : null;
              return (
                <div key={idx} className="inline-flex items-center bg-green-50 border border-green-100 rounded-full overflow-hidden">
                  <button
                    onClick={() => navigate(`/search?teoseTags=${encodeURIComponent(label)}`)}
                    className="px-2.5 py-1 text-sm text-green-800 hover:bg-green-100 transition-colors flex items-center gap-1"
                    title={`Otsi žanrit: ${label}`}
                  >
                    {label.toLowerCase()}
                    <Search size={12} className="opacity-50" />
                  </button>
                  {tagId && (
                    <a
                      href={`https://www.wikidata.org/wiki/${tagId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pr-2 pl-1 py-1 text-green-600 hover:text-green-800 hover:bg-green-100 border-l border-green-100 transition-colors h-full flex items-center"
                      title={`Vaata Wikidatas: ${tagId}`}
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
            
            return (
              <span key={idx} className="inline-flex items-center rounded-full bg-primary-50 border border-primary-100 text-sm text-primary-800 group overflow-hidden">
                <button
                  onClick={() => navigate(`/search?q=${encodeURIComponent(label)}&scope=annotation`)}
                  className="pl-2.5 pr-1.5 py-1 hover:text-primary-600 flex items-center gap-1"
                  title="Otsi seda märksõna kogu korpusest"
                >
                  {label.toLowerCase()}
                  <Search size={12} className="opacity-0 group-hover:opacity-50" />
                </button>
                
                {tagId && (
                  <a
                    href={`https://www.wikidata.org/wiki/${tagId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-1.5 py-1 text-primary-400 hover:text-blue-600 border-l border-primary-100 transition-colors"
                    title={`Vaata Wikidatas: ${tagId}`}
                  >
                    <ExternalLink size={10} />
                  </a>
                )}

                {!readOnly && (
                  <button 
                    onClick={() => removeTag(typeof tag === 'string' ? tag : (tag as any).label)} 
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
            <div key={comment.id} className="bg-gray-50 p-3 rounded-lg border border-gray-100 relative group">
              <p className="text-gray-800 text-sm mb-2 leading-relaxed pr-5">{comment.text}</p>
              <div className="flex justify-between items-center text-xs text-gray-500">
                <span className="font-semibold text-primary-700">{comment.author}</span>
                <span>{new Date(comment.created_at).toLocaleString('et-EE')}</span>
              </div>
              {!readOnly && (
                <button
                  onClick={() => removeComment(comment.id)}
                  className="absolute top-2 right-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white"
                  title="Kustuta kommentaar"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {!readOnly ? (
          <div className="mt-auto">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={t('info.commentPlaceholder')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded mb-2 focus:border-primary-500 focus:ring-1 focus:ring-primary-200 outline-none resize-none h-24"
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
