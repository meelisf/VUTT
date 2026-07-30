import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, Search, Tag, User, X } from 'lucide-react';
import { FILE_API_URL } from '../../config';
import { useMeiliIndex } from '../../contexts/MeilisearchContext';
import { getAllTags } from '../../services/searchService';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { getEntityUrl } from '../../utils/entityUrl';
import { getLabel } from '../../utils/metadataUtils';
import type { LinkedEntity } from '../../types/LinkedEntity';
import EntityPicker from '../EntityPicker';

interface PageTagsPanelProps {
  pageTags: (string | LinkedEntity)[];
  setPageTags: (tags: (string | LinkedEntity)[]) => void;
  readOnly: boolean;
  authToken: string | null;
  lang: string;
}

const PageTagsPanel: React.FC<PageTagsPanelProps> = ({
  pageTags,
  setPageTags,
  readOnly,
  authToken,
  lang,
}) => {
  const { t } = useTranslation(['workspace', 'common', 'dashboard']);
  const navigate = useNavigate();
  const index = useMeiliIndex();
  const [tagSuggestions, setTagSuggestions] = useState<{ label: string; id: string | null }[]>([]);
  const [allAvailableTags, setAllAvailableTags] = useState<{ label: string; id: string | null }[]>([]);

  // Lae soovitused serverist.
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
        console.error('Viga märksõnade laadimisel', e);
      }
    };
    fetchTags();
  }, [authToken, lang]);

  // Lae kõik olemasolevad märksõnad Meilisearchist.
  useEffect(() => {
    if (!index) return;
    const loadTags = async () => {
      const fetchedTags = await getAllTags(index, lang);
      setAllAvailableTags(fetchedTags);
    };
    loadTags();
  }, [lang, index]);

  const mergedTagSuggestions = useMemo(() => {
    // Ühenda ja eemalda duplikaadid (labeli JA ID järgi).
    // Eelistame serveri omasid, siis Meilisearchi omasid.
    const combined = [...tagSuggestions, ...allAvailableTags];
    const uniqueByLabel = new Map();
    const seenIds = new Set<string>();

    combined.forEach(item => {
      if (item.id && seenIds.has(item.id)) return;
      if (item.id) seenIds.add(item.id);

      const key = item.label.toLowerCase();
      const existing = uniqueByLabel.get(key);

      if (!existing) {
        uniqueByLabel.set(key, item);
      } else if (!existing.id && item.id) {
        uniqueByLabel.set(key, item);
      }
    });

    return Array.from(uniqueByLabel.values()).sort((a, b) => a.label.localeCompare(b.label, lang));
  }, [tagSuggestions, allAvailableTags, lang]);

  const removeTag = (tagToRemove: string) => {
    // Eemalda sildi järgi.
    setPageTags(pageTags.filter(t => getLabel(t, lang).toLowerCase() !== tagToRemove.toLowerCase()));
  };

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
        <Tag size={18} className="text-primary-600" />
        <h4 className="font-bold">{t('workspace:info.pageTags')}</h4>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {pageTags.length === 0 && <span className="text-sm text-gray-400 italic">{t('info.noTags')}</span>}
        {pageTags.map((tag, idx) => {
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
                title={t('info.searchTagInCorpus')}
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
                // Lisa märksõna kui teda pole veel listis.
                const label = val.label.toLowerCase();
                const exists = pageTags.some(t => getLabel(t, lang).toLowerCase() === label);
                if (!exists) {
                  setPageTags([...pageTags, val]);
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
  );
};

export default PageTagsPanel;
