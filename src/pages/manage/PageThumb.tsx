import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { FILE_API_URL } from '../../config';
import { useUser } from '../../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { THUMB_MAX_RETRIES, thumbRetryDelay, buildThumbUrl } from '../../utils/thumbRetry';

const PageThumb: React.FC<{ workId: string; src: string; className: string }> = ({ workId, src, className }) => {
  const { authToken } = useUser();
  const { t } = useTranslation(['workspace']);
  const [tokenQuery, setTokenQuery] = useState('');  // "&exp=..&sig=.." kui piiratud teos
  const [nonce, setNonce] = useState(0);             // muutub iga taaskatse korral → sunnib reloadi
  const [failed, setFailed] = useState(false);
  const tokenTriedRef = useRef(false);
  const retryRef = useRef(0);                         // transientsete taaskatsete loendur
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTokenQuery('');
    setNonce(0);
    setFailed(false);
    tokenTriedRef.current = false;
    retryRef.current = 0;
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [src]);

  const imgSrc = buildThumbUrl(src, tokenQuery, nonce);

  const handleError = async () => {
    if (failed) return;
    // 1) Esimene viga: ehk piiratud teos → proovi signeeritud viewer-tokenit.
    if (!tokenTriedRef.current && workId) {
      tokenTriedRef.current = true;
      try {
        const r = await fetchWithTimeout(`${FILE_API_URL}/work/${workId}/viewer-token`, {
          headers: getAuthHeaders(authToken),
          timeout: 10000,
        });
        if (r.ok) {
          const d = await r.json();
          if (d.image_exp && d.image_sig) {
            setTokenQuery(`&exp=${d.image_exp}&sig=${d.image_sig}`);
            return;
          }
        }
      } catch { /* kukub allolevasse transientse retry-loogikasse */ }
    }
    // 2) Transientne viga (aeglane ühendus / serveri thumb-genereerimise viivitus):
    //    proovi uuesti kasvava viivitusega kuni THUMB_MAX_RETRIES, alles siis placeholder.
    if (retryRef.current >= THUMB_MAX_RETRIES) {
      setFailed(true);
      return;
    }
    const next = retryRef.current + 1;
    retryRef.current = next;
    timerRef.current = setTimeout(() => setNonce((n) => n + 1), thumbRetryDelay(next));
  };

  // Käsitsi taaskatse placeholderilt (stopPropagation, et mitte vallandada valikut).
  const handleManualRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    tokenTriedRef.current = false;
    retryRef.current = 0;
    setTokenQuery('');
    setFailed(false);
    setNonce((n) => n + 1);
  };

  if (failed) {
    return (
      <button
        type="button"
        onClick={handleManualRetry}
        title={t('manage.thumb.retryHint')}
        aria-label={t('manage.thumb.retryHint')}
        className="group flex flex-col items-center justify-center gap-1 h-full w-full text-gray-300 hover:text-gray-500 hover:bg-gray-50 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
        </svg>
        <RefreshCw size={13} className="opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  return <img src={imgSrc} alt="" loading="lazy" className={className} onError={handleError} />;
};

export default PageThumb;
