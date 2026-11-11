/**
 * „Kopeeri link" eksemplari vaate modaalide päisesse: püsiv link avatud pildile või
 * kõrvutusele (nt lehe kommentaari panemiseks). Link koostab kutsuja — siin ainult
 * lõikelauale kirjutus ja tagasiside.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Link2 } from 'lucide-react';
import { useNotify } from '../../contexts/FeedbackContext';

const CopyLinkButton: React.FC<{ url: string }> = ({ url }) => {
  const { t } = useTranslation('workspace');
  const notify = useNotify();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Lõikelaud keelatud (nt http, õigus puudub) — näita linki, et saaks käsitsi võtta.
      notify(`${t('exemplarPage.copyLinkFailed')}: ${url}`, 'warning');
    }
  };

  return (
    <button type="button" onClick={() => void copy()} title={t('exemplarPage.copyLinkHint')}
      data-testid="copy-link"
      className="text-sm px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 inline-flex items-center gap-1">
      {copied ? <Check size={14} className="text-green-700" /> : <Link2 size={14} />}
      <span className="hidden sm:inline">{copied ? t('exemplarPage.linkCopied') : t('exemplarPage.copyLink')}</span>
    </button>
  );
};

export default CopyLinkButton;
