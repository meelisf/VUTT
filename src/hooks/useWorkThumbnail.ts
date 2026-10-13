import React, { useMemo, useState } from 'react';
import { Work } from '../types';
import { useCollection } from '../contexts/CollectionContext';
import { useUser } from '../contexts/UserContext';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

/**
 * Teose pisipildi allikas koos piiratud kogu HMAC-tokeniga.
 * Ühine kaardile (`WorkCard`) ja loendireale (`WorkListRow`).
 */
export function useWorkThumbnail(work: Work) {
  const { collections } = useCollection();
  const { authToken } = useUser();
  const [thumbnailSrc, setThumbnailSrc] = useState(work.thumbnail_url);
  const [thumbnailNeedsToken, setThumbnailNeedsToken] = useState(false);
  const thumbnailTokenTriedRef = React.useRef(false);

  React.useEffect(() => {
    setThumbnailSrc(work.thumbnail_url);
    setThumbnailNeedsToken(false);
    thumbnailTokenTriedRef.current = false;
  }, [work.thumbnail_url]);

  const requestThumbnailToken = React.useCallback(async () => {
    if (thumbnailTokenTriedRef.current || !work.work_id) return;

    // AuthContext taastub lehe laadimisel asünkroonselt. Kui protected pildi 403 jõuab
    // enne authToken state'i, kasuta localStorage fallback'i ja ära märgi katset tehtuks
    // enne kui meil päriselt on token, millega viewer-token küsida.
    const token = authToken || localStorage.getItem('vutt_token');
    if (!token) return;

    thumbnailTokenTriedRef.current = true;
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/work/${work.work_id}/viewer-token`, {
        headers: getAuthHeaders(token),
        timeout: 10000,
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.image_exp && data.image_sig) {
        const sep = work.thumbnail_url.includes('?') ? '&' : '?';
        setThumbnailSrc(`${work.thumbnail_url}${sep}exp=${data.image_exp}&sig=${data.image_sig}`);
        setThumbnailNeedsToken(false);
      }
    } catch { /* thumbnail jääb placeholder-taustale */ }
  }, [authToken, work.work_id, work.thumbnail_url]);

  const isRestrictedWork = useMemo(() => {
    const workCollections = work.collections || [];
    if (workCollections.length === 0) return false;
    // Serveri loogika on "public wins": kui kasvõi üks teose otsene kollektsioon
    // on avalik, on pilt avalik. Kui kõik teadaolevad otsesed kollektsioonid on
    // restricted, vajab <img> HMAC-tokenit.
    return workCollections.every(cid => collections[cid]?.visibility === 'restricted');
  }, [collections, work.collections]);

  React.useEffect(() => {
    if (thumbnailNeedsToken || isRestrictedWork) void requestThumbnailToken();
  }, [thumbnailNeedsToken, isRestrictedWork, requestThumbnailToken]);

  const handleThumbnailError = () => {
    setThumbnailNeedsToken(true);
    void requestThumbnailToken();
  };

  return { thumbnailSrc, handleThumbnailError };
}
