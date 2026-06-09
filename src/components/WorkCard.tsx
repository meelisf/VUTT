import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Work, WorkStatus } from '../types';
import { BookOpen, Calendar, User, CheckSquare, Square, ExternalLink, FolderOpen, Bookmark, MapPin, BookDown, Info, Check } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { getLabel } from '../utils/metadataUtils';
import { getEntityUrl } from '../utils/entityUrl';
import { useCollection } from '../contexts/CollectionContext';
import { getCollectionColorClasses } from '../services/collectionService';
import { getLangCode } from '../utils/getLangCode';
import { useUser } from '../contexts/UserContext';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { parseYearDisplayRange } from '../utils/yearDisplayUtils';

interface WorkCardProps {
  work: Work;
  // Multi-select režiim (optional)
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  isPriority?: boolean;
}

const WorkCard: React.FC<WorkCardProps> = ({ work, selectMode = false, isSelected = false, onToggleSelect, isPriority = false }) => {
  const { t, i18n } = useTranslation(['dashboard', 'common', 'workspace']);
  const navigate = useNavigate();
  const { collections, getCollectionName } = useCollection();
  const { authToken } = useUser();
  const [thumbnailSrc, setThumbnailSrc] = useState(work.thumbnail_url);
  const thumbnailTokenTriedRef = React.useRef(false);

  React.useEffect(() => {
    setThumbnailSrc(work.thumbnail_url);
    thumbnailTokenTriedRef.current = false;
  }, [work.thumbnail_url]);

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

  // Info-overlay nähtavus (desktop: hover + 150ms delay, mobiil: touch-hold)
  const [infoVisible, setInfoVisible] = useState(false);
  const infoDelayRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyInfo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const lang = getLangCode(i18n.language) as 'et' | 'en';
    const parts: string[] = [work.title];
    if (work.creators && work.creators.length > 0) {
      parts.push(work.creators.map(c => c.name).join(', '));
    }
    if (work.archive_refs && work.archive_refs.length > 0) {
      parts.push(work.archive_refs.map(r => `${r.archive_id}${r.reference ? ' ' + r.reference : ''}`).join('; '));
    } else {
      if (work.publisher) parts.push(getLabel(work.publisher, lang));
      if (work.location) parts.push(getLabel(work.location, lang));
    }
    navigator.clipboard.writeText(parts.filter(Boolean).join(' — ')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleThumbnailError = async () => {
    if (thumbnailTokenTriedRef.current || !work.work_id) return;
    thumbnailTokenTriedRef.current = true;
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/work/${work.work_id}/viewer-token`, {
        headers: getAuthHeaders(authToken),
        timeout: 10000,
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.image_exp && data.image_sig) {
        const sep = work.thumbnail_url.includes('?') ? '&' : '?';
        setThumbnailSrc(`${work.thumbnail_url}${sep}exp=${data.image_exp}&sig=${data.image_sig}`);
      }
    } catch { /* thumbnail jääb placeholder-taustale */ }
  };

  // Navigeeri töölaudale
  const handleOpenWorkspace = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(`/work/${work.work_id}/1`);
  };

  // Staatuse täpp stiilid
  const getStatusDotStyle = (status?: WorkStatus) => {
    switch (status) {
      case 'Valmis': return 'bg-green-500';
      case 'Töös': return 'bg-amber-400';
      case 'Toores': default: return 'bg-gray-300';
    }
  };

  // Žanrid massiivist (toetab nii massiivi kui üksikut väärtust)
  const genres: any[] = (() => {
    const raw = work.genre;
    if (Array.isArray(raw) && raw.length > 0) return raw;
    if (raw) return [raw];
    return [];
  })();

  const displayTags = work.tags || [];

  const lang = getLangCode(i18n.language);

  // Autorite kuvamise loogika
  const renderAuthors = () => {
    // Eelista struktureeritud andmeid (creators)
    if (work.creators && work.creators.length > 0) {
      // Näita max 2 autorit, ülejäänud "+X"
      const displayCreators = work.creators.slice(0, 2);
      const remaining = work.creators.length - 2;

      return (
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-gray-600">
          <User size={14} className="shrink-0" />
          {displayCreators.map((creator, idx) => {
            const isRespondens = creator.role === 'respondens';
            const paramName = isRespondens ? 'respondens' : 'author';
            const hasProsopoId = creator.id?.startsWith('vutt:P');

            return (
              <span key={idx} className="flex items-center gap-1">
                {hasProsopoId ? (
                  <Link
                    to={`/persons/${creator.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-primary-600 transition-colors truncate max-w-[150px] hover:underline"
                    title={t('workCard.viewPerson', 'Vaata isiku lehte')}
                  >
                    {creator.name}
                  </Link>
                ) : (
                  <Link
                    to={`/?${paramName}=${encodeURIComponent(creator.name)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:text-primary-600 transition-colors truncate max-w-[150px] hover:underline"
                    title={t('workCard.searchAuthor', 'Otsi autorit')}
                  >
                    {creator.name}
                  </Link>
                )}
                {!hasProsopoId && getEntityUrl(creator.id, creator.source) ? (
                  <a
                    href={getEntityUrl(creator.id, creator.source)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
                    title={creator.id || ''}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink size={10} />
                  </a>
                ) : null}
                {idx < displayCreators.length - 1 && <span className="text-gray-400">/</span>}
              </span>
            );
          })}
          {remaining > 0 && <span className="text-xs text-gray-400">+{remaining}</span>}
        </div>
      );
    }

    return null;
  };

  return (
    <div
      className={`bg-white border rounded-lg shadow-sm hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden relative group/card ${
        selectMode ? 'cursor-pointer' : ''
      } ${
        isSelected
          ? 'border-primary-500 ring-2 ring-primary-200'
          : 'border-gray-200'
      }`}
      onClick={handleCardClick}
    >
      <div className="h-40 bg-gray-100 relative overflow-hidden">
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
          src={thumbnailSrc}
          alt={work.title}
          loading={isPriority ? 'eager' : 'lazy'}
          fetchPriority={isPriority ? 'high' : 'auto'}
          onError={handleThumbnailError}
          onClick={!selectMode ? handleOpenWorkspace : undefined}
          className={`w-full h-full object-cover opacity-90 group-hover/card:opacity-100 transition-opacity ${!selectMode ? 'cursor-pointer' : ''}`}
        />
        {/* Žanrid pildi peal (max 3, kompaktne) */}
        {displayTags.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent pt-8 pb-2 px-2">
            <div className="flex flex-wrap items-center gap-1">
              {displayTags.slice(0, 3).map((tag, idx) => {
                const label = getLabel(tag, lang);
                const tagId = typeof tag !== 'string' ? tag.id : null;
                const entityType = typeof tag !== 'string' ? (tag as any).entity_type : null;
                const isPersonTag = entityType === 'person' || tagId?.startsWith('vutt:P');
                const prosopoId = tagId?.startsWith('vutt:P') ? tagId : null;

                if (isPersonTag) {
                  return prosopoId ? (
                    <Link
                      key={idx}
                      to={`/persons/${prosopoId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 bg-primary-600/80 hover:bg-primary-500/90 rounded backdrop-blur-sm transition-colors px-1.5 py-0.5"
                      title={t('workCard.viewPerson', 'Vaata isiku lehte')}
                    >
                      <User size={8} className="text-white/80" />
                      <span className="text-[10px] font-medium text-white">{label}</span>
                    </Link>
                  ) : (
                    <a
                      key={idx}
                      href={getEntityUrl(tagId, typeof tag !== 'string' ? tag.source : undefined) ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 bg-primary-600/80 hover:bg-primary-500/90 rounded backdrop-blur-sm transition-colors px-1.5 py-0.5"
                    >
                      <User size={8} className="text-white/80" />
                      <span className="text-[10px] font-medium text-white">{label}</span>
                    </a>
                  );
                }

                return (
                  <div key={idx} className="flex items-center bg-slate-800/60 hover:bg-primary-600/80 rounded backdrop-blur-sm transition-colors overflow-hidden">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const tagUrlValue = tagId || label;
                        navigate(`/?tags=${encodeURIComponent(tagUrlValue)}`);
                      }}
                      className="text-[10px] font-medium text-white px-1.5 py-0.5"
                      title={t('workCard.searchTag', { tag: label })}
                    >
                      {label}
                    </button>
                    {getEntityUrl(tagId, typeof tag !== 'string' ? tag.source : undefined) && (
                      <a
                        href={getEntityUrl(tagId, typeof tag !== 'string' ? tag.source : undefined)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-1 py-0.5 hover:bg-white/20 text-white/70 hover:text-white border-l border-white/10"
                        title={tagId || ''}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={8} />
                      </a>
                    )}
                  </div>
                );
              })}
              {displayTags.length > 3 && (
                <span
                  className="text-[10px] text-white/80 bg-slate-800/40 px-1.5 py-0.5 rounded"
                  title={displayTags.slice(3).map(t => getLabel(t, lang)).join(', ')}
                >
                  +{displayTags.length - 3}
                </span>
              )}
            </div>
          </div>
        )}

      </div>

      <div className="p-4 flex-1 flex flex-col">

        <h3 className="text-lg font-bold text-gray-900 mb-1 leading-tight line-clamp-2">
          <a
            href={`/work/${work.work_id}/1`}
            onClick={handleOpenWorkspace}
            className="hover:text-primary-600 transition-colors cursor-pointer"
          >
            {work.title}
          </a>
        </h3>

        <div className="mt-2 space-y-2 text-sm text-gray-600 flex-1">
          {renderAuthors()}
          
          <button
            onClick={(e) => {
              e.preventDefault();
              const range = parseYearDisplayRange(work.year, work.year_display);
              if (range) navigate(`/?ys=${range.start}&ye=${range.end}`);
            }}
            className="flex items-center gap-2 hover:text-primary-600 transition-colors text-left w-full"
            title={t('workCard.filterByYear')}
          >
            <Calendar size={14} />
            <span>{work.year_display || work.year}</span>
          </button>
          <div className="flex items-center gap-2">
            <BookOpen size={14} />
            <span>{work.page_count} {t('common:labels.pages')}</span>
          </div>
          {/* Kollektsioonide badged */}
          {(work.collections || []).filter(cid => collections[cid]).map(cid => {
            const colorClasses = getCollectionColorClasses(collections[cid]);
            return (
              <button
                key={cid}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/?collection=${encodeURIComponent(cid)}`);
                }}
                className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full cursor-pointer transition-colors max-w-full ${colorClasses.bg} ${colorClasses.text} ${colorClasses.hoverBg}`}
                title={getCollectionName(cid, lang as 'et' | 'en')}
              >
                <FolderOpen size={12} className="shrink-0" />
                <span className="truncate">{getCollectionName(cid, lang as 'et' | 'en')}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-1 min-w-0">
          {/* Žanrid vasakul — kuni 2, siis +N */}
          {genres.slice(0, 2).map((g, i) => {
            const label = getLabel(g, lang);
            const genreUrlValue = (typeof g !== 'string' && g.id) ? g.id : label;
            return (
              <button
                key={i}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/?genre=${encodeURIComponent(genreUrlValue)}`); }}
                className="flex items-center gap-0.5 text-[13px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors shrink-0"
                title={t('workCard.filterByGenre', { genre: label })}
              >
                <Bookmark size={10} className="fill-violet-200 shrink-0" />
                <span className="truncate max-w-[80px]">{label}</span>
              </button>
            );
          })}
          {genres.length > 2 && (
            <span className="text-[10px] text-gray-400 shrink-0">+{genres.length - 2}</span>
          )}
          <span className="flex-1" />
          {/* Staatus — värviline täpp */}
          <button
            onClick={(e) => { e.preventDefault(); navigate(`/?status=${encodeURIComponent(workStatus)}`); }}
            className="p-1 rounded-full hover:bg-gray-100 transition-colors shrink-0"
            title={t('workCard.filterByStatus', { status: t(`common:status.${workStatus}`) })}
          >
            <span className={`block w-2.5 h-2.5 rounded-full ${getStatusDotStyle(workStatus)}`} />
          </button>
        </div>
      </div >

      {/* Info-ikoon + täiskaardi metaandmete overlay */}
      {!selectMode && (
        <>
          {/* "Kopeeritud" teade nupu kõrval */}
          <div className={`absolute top-2 right-9 z-30 bg-green-600 text-white text-[11px] px-2 py-0.5 rounded pointer-events-none transition-opacity duration-300 ${copied ? 'opacity-100' : 'opacity-0'}`}>
            {t('workCard.copied', 'Kopeeritud')}
          </div>

          {/* Info-nupp — desktop hover + mobiil touch-hold */}
          <button
            className={`absolute top-2 right-2 z-30 w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-sm transition-all duration-150 hover:scale-110 ${copied ? 'bg-green-500/80 hover:bg-green-500/90' : 'bg-black/25 hover:bg-black/50'}`}
            onClick={handleCopyInfo}
            onMouseEnter={() => { infoDelayRef.current = setTimeout(() => setInfoVisible(true), 200); }}
            onMouseLeave={() => { if (infoDelayRef.current) clearTimeout(infoDelayRef.current); setInfoVisible(false); }}
            onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); setInfoVisible(v => !v); }}
            tabIndex={-1}
            aria-label={copied ? t('workCard.copied', 'Kopeeritud') : t('workCard.showMetadata', 'Näita metaandmeid')}
          >
            {copied ? <Check size={11} className="text-white" /> : <Info size={11} className="text-white/90" />}
          </button>

          {/* Overlay — katab kogu kaardi; mobiilil toks suleb */}
          <div
            className={`absolute inset-0 z-20 transition-opacity duration-200 bg-black/70 backdrop-blur-sm rounded-lg p-4 flex flex-col gap-2 ${infoVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            onTouchStart={(e) => { e.stopPropagation(); setInfoVisible(false); }}
          >
            {/* Pealkiri */}
            <p className="font-semibold text-[13px] text-white leading-[1.2]">{work.title}</p>

            {/* Isikud */}
            {work.creators && work.creators.length > 0 && (
              <div className="space-y-1">
                {work.creators.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-[9px] uppercase tracking-widest font-semibold text-indigo-300 shrink-0 pt-0.5 min-w-[52px] leading-snug">
                      {t(`workspace:metadata.roles.${c.role}`, c.role)}
                    </span>
                    <span className="text-[13px] text-gray-200 leading-snug">{c.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Trükkal, trükikoht ja arhiiviviited */}
            {(work.publisher || work.location || (work.archive_refs && work.archive_refs.length > 0)) && (
              <div className="border-t border-white/10 pt-2 mt-auto space-y-1">
                {work.publisher && (
                  <div className="flex items-center gap-1.5 text-[13px] text-gray-400">
                    <BookDown size={10} className="text-gray-500 shrink-0" />
                    <span className="truncate">{getLabel(work.publisher, lang)}</span>
                  </div>
                )}
                {work.location && (
                  <div className="flex items-center gap-1.5 text-[13px] text-gray-400">
                    <MapPin size={10} className="text-gray-500 shrink-0" />
                    <span>{getLabel(work.location, lang)}</span>
                  </div>
                )}
                {work.archive_refs && work.archive_refs.map((ref, idx) => (
                  <div key={idx} className="flex items-start gap-1.5 text-[13px] text-gray-400">
                    <Bookmark size={10} className="text-gray-500 shrink-0 mt-0.5" />
                    <span className="truncate">{ref.archive_id}{ref.reference ? ` ${ref.reference}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div >
  );
};

export default WorkCard;