import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bookmark, Check, ChevronDown, FolderOpen, Library, Link2, X } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { getCollectionColorClasses, getCollectionHierarchy } from '../services/collectionService';
import { COLLECTION_PARAM, serializeSelection } from '../contexts/collectionUrl';
import { getLangCode } from '../utils/getLangCode';
import { useCollectionCounts } from '../hooks/useCollectionCounts';
import { useMediaQuery } from '../hooks/useMediaQuery';
import CollectionPicker from './CollectionPicker';

/**
 * Kogu-riba päise all (#587): milline vaade on aktiivne. Asendab
 * `CollectionInfoBanner`-i. Kogul: vanemkogud (lingid), nimi, lühikirjeldus,
 * „Kogu kirjeldus" (`description_long` riba sisse), permalink, „× Kõik kogud".
 * Töökollektsioonil violetne toon ja haldurile „Halda".
 *
 * Muutub ainult kuvamine — valik käib `setSelection`-i kaudu ja URL-i sünk elab
 * edasi `useCollectionUrlSync`-is (ADR 0038).
 *
 * Kitsal ekraanil (`md`-st kitsam, päise valija on peidus) on riba ise valija:
 * nimi avab `CollectionPicker`-i modaali. Eraldi mobiilinuppu ei ole — see
 * kordas sama kogu kaks korda üksteise all. „Kõik tööd" olekus näidatakse
 * kitsal ekraanil kompaktset rida, et valikuni üldse pääseks; laial ekraanil
 * riba siis puudub.
 *
 * `scopeHidden`: leht teab, et valik teda ei piira (isikud ilma ligipääsuta
 * kogule) — riba käitub nagu „Kõik tööd" olekus.
 */
const CollectionBar: React.FC<{ scopeHidden?: boolean }> = ({ scopeHidden = false }) => {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const { selection, setSelection, collections, workSets, isLoading } = useCollection();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const counts = useCollectionCounts();
  const lang = getLangCode(i18n.language);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const picker = !isDesktop && (
    <CollectionPicker isOpen={pickerOpen} onClose={() => setPickerOpen(false)} />
  );

  if (selection.kind === 'all' || scopeHidden) {
    if (isDesktop) return null;
    return (
      <div className="border-b bg-white border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-haspopup="dialog"
            className="flex items-center gap-2 text-sm font-medium text-gray-700"
          >
            <Library size={16} className="text-primary-600" />
            {t('common:collections.all')}
            <ChevronDown size={14} className="opacity-50" />
          </button>
        </div>
        {picker}
      </div>
    );
  }

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
  // Kitsal ekraanil ainult nimi (= valija): kirjeldus, arv ja vanemkogud
  // söövad vertikaalset ruumi; arv on loendi päises, vanemad valija modaalis.
  const parents = collection && isDesktop ? getCollectionHierarchy(collections, selection.id).slice(0, -1) : [];

  const handleCopy = async () => {
    const url = `${window.location.origin}/?${COLLECTION_PARAM}=${encodeURIComponent(serializeSelection(selection))}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* lõikelaud keelatud — nupp jääb muutumata */ }
  };

  const icon = isSet ? <Bookmark size={16} /> : <FolderOpen size={16} />;
  const subtle = `text-sm ${tone.text} opacity-75 hover:opacity-100 transition-opacity`;

  return (
    <div className={`border-b ${tone.bg} ${tone.border}`}>
      <div className={`max-w-7xl mx-auto px-4 sm:px-8 ${isDesktop ? 'py-3' : 'py-2'}`}>
        <div className={`flex gap-4 ${isDesktop ? 'items-start' : 'items-center'}`}>
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          {isDesktop && <span className={`${tone.text} opacity-80`}>{icon}</span>}
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
          <h1 className={`${isDesktop ? 'text-lg font-semibold' : 'text-sm font-medium'} ${tone.text}`}>
            {isDesktop ? name : (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-haspopup="dialog"
                className="text-left"
              >
                {/* Ikoonid teksti sees (mitte flex): murduval nimel jääb noolke
                    viimase sõna järele, mitte rea paremasse serva */}
                <span className="inline-block align-[-3px] mr-2 opacity-80">{icon}</span>
                {name}
                <ChevronDown size={14} className="inline-block align-[-2px] ml-1.5 opacity-50" />
              </button>
            )}
          </h1>
          {isDesktop && description && <span className={`text-sm ${tone.text} opacity-75`}>{description}</span>}
          {isDesktop && count !== undefined && (
            <span className={`text-sm ${tone.text} opacity-75 tabular-nums whitespace-nowrap`}>
              {t('collection.workCount', { count })}
            </span>
          )}
          {isDesktop && descriptionLong && (
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
        <div className={`shrink-0 flex items-center gap-3 ${isDesktop ? 'pt-1' : ''}`}>
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
        {isDesktop && expanded && descriptionLong && (
          <p className={`mt-3 max-w-prose text-sm leading-relaxed whitespace-pre-line ${tone.text}`}>
            {descriptionLong}
          </p>
        )}
      </div>
      {picker}
    </div>
  );
};

export default CollectionBar;
