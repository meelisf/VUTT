import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { useImageTokenFetcher, withImageToken, type ImageToken } from '../contexts/ImageTokenContext';
import { thumbRetryDelay, buildThumbUrl } from '../utils/thumbRetry';

type ThumbStatus = 'loading' | 'ok' | 'error';

/**
 * Lehe pisipilt, mis tuleb piiratud teose pildiga ise toime (#673):
 * viga → pildiallkiri (`useImageTokenFetcher`, ühine vahemälu) → uus katse.
 * Kasutavad otsingutulemused, kirjaotsing ja teose haldus.
 */
const PageThumbnail: React.FC<{
  workId: string;
  src: string;
  className: string;
  /** Teadaolevalt piiratud teos → küsi allkiri kohe, mitte alles esimese vea järel. */
  restricted?: boolean;
  /** Proovi kasvava viivitusega edasi (haldus: pisipilt võib alles genereeruda). */
  retry?: boolean;
  /** Pildi kuvasuhe (laius/kõrgus) laadimisel — poolitusjoone paigutuseks kaardil. */
  onAspect?: (ratio: number) => void;
  /** Eelvaate teisendus (nt ootel pööre, #431). */
  imgStyle?: React.CSSProperties;
}> = ({ workId, src, className, restricted = false, retry = false, onAspect, imgStyle }) => {
  const { t } = useTranslation(['workspace']);
  const getImageToken = useImageTokenFetcher();
  // Allkiri koos src-iga, millele ta käib — teise src-i jaoks ta ei kehti.
  const [token, setToken] = useState<{ src: string; token: ImageToken } | null>(null);
  const [nonce, setNonce] = useState(0);             // muutub iga taaskatse korral → sunnib reloadi
  const [status, setStatus] = useState<ThumbStatus>('loading');
  const retryRef = useRef(0);                         // taaskatsete loendur (backoffi jaoks)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const srcRef = useRef(src);
  srcRef.current = src;

  // Kutsuja võib allkirja ise src-i panna (haldus värskendab seda perioodiliselt).
  const srcHasImageToken = src.includes('exp=') && src.includes('sig=');
  const activeToken = token?.src === src ? token.token : null;

  useEffect(() => {
    setNonce(0);
    setStatus('loading');
    retryRef.current = 0;
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [src]);

  useEffect(() => {
    if (!restricted || srcHasImageToken || !workId) return;
    let cancelled = false;
    void getImageToken(workId).then(tok => {
      if (!cancelled && tok) setToken({ src, token: tok });
    });
    return () => { cancelled = true; };
  }, [restricted, srcHasImageToken, workId, src, getImageToken]);

  const imgSrc = buildThumbUrl(withImageToken(src, activeToken), '', nonce);

  const scheduleReload = (delay: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNonce((n) => n + 1), delay);
  };

  const handleError = async () => {
    // 1) Ehk piiratud teos (või allkiri aegus) → proovi allkirja. Vahemälu hoiab
    //    serveri lõpliku „ei" meeles ja võrgutõrge proovib järgmisel korral uuesti,
    //    seega iga kordus EI tee päringut.
    if (!srcHasImageToken && workId) {
      const failedSrc = src;
      const tok = await getImageToken(workId);
      if (srcRef.current !== failedSrc) return;
      if (tok && (tok.exp !== activeToken?.exp || tok.sig !== activeToken?.sig)) {
        setToken({ src: failedSrc, token: tok });
        return;
      }
    }
    setStatus('error');
    // 2) Transientne viga (aeglane ühendus / serveri thumb-genereerimise viivitus):
    //    JÄTKA proovimist kasvava (kuni ~5s) viivitusega — <img> jääb monteerituks,
    //    nii laeb pisipilt ISE niipea kui ühendus/server jõuab. EI loobu jäädavalt.
    if (retry) {
      retryRef.current += 1;
      scheduleReload(thumbRetryDelay(retryRef.current));
    }
  };

  // Käsitsi kohene taaskatse (nullib backoffi). stopPropagation, et mitte vallandada valikut.
  const handleManualRetry = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
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
        style={imgStyle}
        onLoad={(e) => {
          const im = e.currentTarget;
          if (onAspect && im.naturalHeight) onAspect(im.naturalWidth / im.naturalHeight);
          if (timerRef.current) clearTimeout(timerRef.current);
          retryRef.current = 0;
          setStatus('ok');
        }}
        onError={handleError}
        className={`${className} ${status === 'error' ? 'invisible' : ''}`}
      />
      {/* Veaolek: nähtav placeholder (retry-režiimis proovib taustal edasi). Keskel
          ikoon on klõpsatav koheseks taaskatseks; ülejäänud ala laseb klõpsu läbi. */}
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

export default PageThumbnail;
