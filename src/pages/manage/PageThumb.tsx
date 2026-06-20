import React, { useState, useEffect, useRef } from 'react';
import { FILE_API_URL } from '../../config';
import { useUser } from '../../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';

const PageThumb: React.FC<{ workId: string; src: string; className: string }> = ({ workId, src, className }) => {
  const { authToken } = useUser();
  const [imgSrc, setImgSrc] = useState(src);
  const [failed, setFailed] = useState(false);
  const triedRef = useRef(false);

  useEffect(() => {
    setImgSrc(src);
    setFailed(false);
    triedRef.current = false;
  }, [src]);

  const handleError = async () => {
    if (triedRef.current || !workId) { setFailed(true); return; }
    triedRef.current = true;
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/work/${workId}/viewer-token`, {
        headers: getAuthHeaders(authToken),
        timeout: 10000,
      });
      if (!response.ok) { setFailed(true); return; }
      const data = await response.json();
      if (data.image_exp && data.image_sig) {
        const sep = src.includes('?') ? '&' : '?';
        setImgSrc(`${src}${sep}exp=${data.image_exp}&sig=${data.image_sig}`);
      } else {
        setFailed(true);
      }
    } catch { setFailed(true); }
  };

  if (failed) {
    return (
      <div className="flex items-center justify-center h-full text-gray-300">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
        </svg>
      </div>
    );
  }

  return <img src={imgSrc} alt="" loading="lazy" className={className} onError={handleError} />;
};

export default PageThumb;
