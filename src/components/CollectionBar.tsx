import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bookmark, Check, FolderOpen, Link2, X } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { getCollectionColorClasses, getCollectionHierarchy } from '../services/collectionService';
import { COLLECTION_PARAM, serializeSelection } from '../contexts/collectionUrl';
import { getLangCode } from '../utils/getLangCode';
import { useCollectionCounts } from '../hooks/useCollectionCounts';

/**
 * Kogu-riba päise all (#587): milline vaade on aktiivne. Asendab
 * `CollectionInfoBanner`-i. Kogul: vanemkogud (lingid), nimi, lühikirjeldus,
 * „Kogu kirjeldus" (`description_long` riba sisse), permalink, „× Kõik kogud".
 * Töökollektsioonil violetne toon ja haldurile „Halda".
 *
 * Muutub ainult kuvamine — valik käib `setSelection`-i kaudu ja URL-i sünk elab
 * edasi `useCollectionUrlSync`-is (ADR 0038).
 */
const CollectionBar: React.FC = () => {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const { selection, setSelection, collections, workSets, isLoading } = useCollection();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const counts = useCollectionCounts();
  const lang = getLangCode(i18n.language);

  if (selection.kind === 'all') return null;

  const isSet = selection.kind === 'work_set';
  const collection = isSet ? null : collections[selection.id];
  const workSet = isSet ? workSets.find(w => w.id === selection.id) : null;

  if (!collection && !workSet) {
    // Kogud laadivad — reserveeri ruum, et vältida CLS-i
    return isLoading ? <div className="h-12 bg-gray-100 animate-pulse" /> : null;
  }

  const pick = (r?: { et?: string; en?: string }) => r?.[lang] || r?.et || r?.en || '';
  const colors = collection ? getCollectionColorClasses(collection) : null;
  const tone = colors
    ? { bg: colors.bg, border: colors.border, text: colors.text }
    : { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-900' };

  const name = collection ? pick(collection.name) : pick(workSet!.name) || workSet!.id;
  const description = collection ? pick(collection.description) : pick(workSet!.description);
  const descriptionLong = collection ? pick(collection.description_long) : '';
  // Arv tuleb kutsuja enda ahelast (#319 p2): püsikogul Meili facet, töökollektsioonil
  // serveri `count` (otsingus nähtavad liikmed). Laadimata = ei näidata midagi.
  const count = collection ? counts?.byCollection[selection.id] ?? (counts ? 0 : undefined) : workSet!.count;
  const parents = collection ? getCollectionHierarchy(collections, selection.id).slice(0, -1) : [];

  const handleCopy = async () => {
    const url = `${window.location.origin}/?${COLLECTION_PARAM}=${encodeURIComponent(serializeSelection(selection))}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* lõikelaud keelatud — nupp jääb muutumata */ }
  };

  const subtle = `text-sm ${tone.text} opacity-75 hover:opacity-100 transition-opacity`;

  return (
    <div className={`border-b ${tone.bg} ${tone.border}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3">
        <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={`${tone.text} opacity-80`}>
            {isSet ? <Bookmark size={16} /> : <FolderOpen size={16} />}
          </span>
          {parents.map(id => (
            <React.Fragment key={id}>
              <button
                type="button"
                onClick={() => setSelection({ kind: 'collection', id })}
                className={`text-sm ${tone.text} opacity-70 hover:opacity-100 hover:underline underline-offset-2`}
              >
                {pick(collections[id]?.name) || id}
              </button>
              <span className={`text-sm ${tone.text} opacity-50`}>›</span>
            </React.Fragment>
          ))}
          <h1 className={`text-lg font-semibold ${tone.text}`}>{name}</h1>
          {description && <span className={`text-sm ${tone.text} opacity-75`}>{description}</span>}
          {count !== undefined && (
            <span className={`text-sm ${tone.text} opacity-75 tabular-nums whitespace-nowrap`}>
              {t('collection.workCount', { count })}
            </span>
          )}
          {descriptionLong && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className={`${subtle} underline decoration-dotted underline-offset-4`}
            >
              {expanded ? t('collection.hideDescription') : t('collection.showDescription')}
            </button>
          )}
          {workSet?.can_manage && (
            <Link to={`/admin/work-sets?set=${encodeURIComponent(workSet.id)}`} className={subtle}>
              {t('collection.manage')}
            </Link>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-3 pt-1">
          <button type="button" onClick={handleCopy} className={`${subtle} inline-flex items-center gap-1`} title={t('collection.copyLink')}>
            {copied ? <Check size={14} /> : <Link2 size={14} />}
            <span className="hidden sm:inline">{copied ? t('collection.linkCopied') : t('collection.copyLink')}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelection({ kind: 'all' })}
            aria-label={t('common:collections.allShort')}
            className={`${subtle} inline-flex items-center gap-1`}
          >
            <X size={14} /> <span className="hidden sm:inline">{t('common:collections.allShort')}</span>
          </button>
        </div>
        </div>
        {expanded && descriptionLong && (
          <p className={`mt-3 max-w-prose text-sm leading-relaxed whitespace-pre-line ${tone.text}`}>
            {descriptionLong}
          </p>
        )}
      </div>
    </div>
  );
};

export default CollectionBar;
