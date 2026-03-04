import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { getCollectionColorClasses } from '../services/collectionService';

/**
 * DSpace-stiilis kollektsiooni infobänner Dashboardi kohal.
 * Näitab leivaraasud, lühikirjeldust ja permalingi kopeerimisnuppu.
 * Kuvatakse ainult kui kollektsioon on valitud.
 */
const CollectionInfoBanner: React.FC = () => {
  const { t, i18n } = useTranslation('dashboard');
  const { selectedCollection, collections, getCollectionPath } = useCollection();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!selectedCollection) return null;

  const collection = collections[selectedCollection];
  if (!collection) return null;

  const lang = i18n.language.split('-')[0] as 'et' | 'en';
  const colorClasses = getCollectionColorClasses(collection);
  const breadcrumb = getCollectionPath(selectedCollection, lang);

  const description = collection.description?.[lang] || collection.description?.et;
  const descriptionLong = collection.description_long?.[lang] || collection.description_long?.et;
  const hasDescription = Boolean(description || descriptionLong);

  if (!hasDescription) {
    // Ainult leivaraasud + permalink kui kirjeldust pole
    return (
      <div className={`mb-6 flex items-center justify-between gap-4 px-4 py-2.5 rounded-lg border ${colorClasses.bg} ${colorClasses.border}`}>
        <span className={`text-sm font-medium ${colorClasses.text}`}>
          {breadcrumb.join(' › ')}
        </span>
        <CopyLinkButton
          collectionId={selectedCollection}
          colorClasses={colorClasses}
          copied={copied}
          setCopied={setCopied}
          label={t('collection.copyLink')}
          labelCopied={t('collection.linkCopied')}
        />
      </div>
    );
  }

  return (
    <div className={`mb-6 rounded-lg border ${colorClasses.border} overflow-hidden`}>
      {/* Peaosa */}
      <div className={`px-4 py-3 ${colorClasses.bg}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Leivaraasud */}
            <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${colorClasses.text} opacity-70`}>
              {breadcrumb.join(' › ')}
            </p>
            {/* Lühikirjeldus */}
            {description && (
              <p className={`text-sm leading-relaxed ${colorClasses.text}`}>
                {description}
              </p>
            )}
            {/* Nupud: loe lähemalt + kopeeri */}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {descriptionLong && (
                <button
                  onClick={() => setExpanded(prev => !prev)}
                  className={`inline-flex items-center gap-1 text-xs font-medium ${colorClasses.text} hover:underline`}
                >
                  {expanded ? (
                    <>{t('collection.readLess')} <ChevronUp size={13} /></>
                  ) : (
                    <>{t('collection.readMore')} <ChevronDown size={13} /></>
                  )}
                </button>
              )}
              <CopyLinkButton
                collectionId={selectedCollection}
                colorClasses={colorClasses}
                copied={copied}
                setCopied={setCopied}
                label={t('collection.copyLink')}
                labelCopied={t('collection.linkCopied')}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Pikk kirjeldus (laiendatav) */}
      {expanded && descriptionLong && (
        <div className={`px-4 py-3 border-t ${colorClasses.border} bg-white`}>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
            {descriptionLong}
          </p>
        </div>
      )}
    </div>
  );
};

// =========================================================
// ALAMKOMPONENT: Kopeeri link nupp
// =========================================================

interface CopyLinkButtonProps {
  collectionId: string;
  colorClasses: { bg: string; text: string; border: string; hoverBg: string };
  copied: boolean;
  setCopied: (v: boolean) => void;
  label: string;
  labelCopied: string;
}

const CopyLinkButton: React.FC<CopyLinkButtonProps> = ({
  collectionId, colorClasses, copied, setCopied, label, labelCopied
}) => {
  const handleCopy = async () => {
    const url = `${window.location.origin}/?collection=${encodeURIComponent(collectionId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback vanemate brauserite jaoks
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded border ${colorClasses.border} ${colorClasses.hoverBg} ${colorClasses.text} transition-colors`}
      title={label}
    >
      {copied ? (
        <><Check size={12} /> {labelCopied}</>
      ) : (
        <><Link2 size={12} /> {label}</>
      )}
    </button>
  );
};

export default CollectionInfoBanner;
