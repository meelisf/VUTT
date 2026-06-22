import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { FILE_API_URL } from '../../config';
import { useUser } from '../../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { thumbRetryDelay, buildThumbUrl } from '../../utils/thumbRetry';

type ThumbStatus = 'loading' | 'ok' | 'error';

const PageThumb: React.FC<{ workId: string; src: string; className: string }> = ({ workId, src, className }) => {
  const { authToken } = useUser();
  const { t } = useTranslation(['workspace']);
  const [tokenQuery, setTokenQuery] = useState('');  // "&exp=..&sig=.." kui piiratud teos
  const [nonce, setNonce] = useState(0);             // muutub iga taaskatse korral → sunnib reloadi
  const [status, setStatus] = useState<ThumbStatus>('loading');
  const tokenTriedRef = useRef(false);
  const retryRef = useRef(0);                         // taaskatsete loendur (backoffi jaoks)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTokenQuery('');
    setNonce(0);
    setStatus('loading');
    tokenTriedRef.current = false;
    retryRef.current = 0;
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [src]);

  const imgSrc = buildThumbUrl(src, tokenQuery, nonce);

  const scheduleReload = (delay: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNonce((n) => n + 1), delay);
  };

  const handleError = async () => {
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
    //    JÄTKA proovimist kasvava (kuni ~5s) viivitusega — <img> jääb monteerituks,
    //    nii laeb pisipilt ISE niipea kui ühendus/server jõuab. EI loobu jäädavalt.
    setStatus('error');
    retryRef.current += 1;
    scheduleReload(thumbRetryDelay(retryRef.current));
  };

  // Käsitsi kohene taaskatse (nullib backoffi). stopPropagation, et mitte vallandada valikut.
  const handleManualRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    tokenTriedRef.current = false;
    retryRef.current = 0;
    setStatus('loading');
    setNonce((n) => n + 1);
  };

  return (
    <div className="relative h-full w-full">
      <img
        src={imgSrc}
        alt=""
        loading="lazy"
        onLoad={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          retryRef.current = 0;
          setStatus('ok');
        }}
        onError={handleError}
        className={`${className} ${status === 'error' ? 'invisible' : ''}`}
      />
      {/* Veaolek: nähtav placeholder, mis proovib taustal edasi laadida. Keskel
          ikoon on klõpsatav koheseks taaskatseks; ülejäänud ala laseb valikuklõpsu läbi. */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 pointer-events-none">
          <button
            type="button"
            onClick={handleManualRetry}
            title={t('manage.thumb.retryHint')}
            aria-label={t('manage.thumb.retryHint')}
            className="group pointer-events-auto flex flex-col items-center gap-1 p-1 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-200/60 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
            </svg>
            <RefreshCw size={13} className="opacity-60 group-hover:opacity-100 transition-opacity" />
          </button>
        </div>
      )}
    </div>
  );
};

export default PageThumb;
