import React, { useMemo, useState } from 'react';
import { Work } from '../types';
import { useCollection } from '../contexts/CollectionContext';
import { useUser } from '../contexts/UserContext';
import { FILE_API_URL } from '../config';
import { isCollectionRestricted } from '../services/collectionService';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

/**
 * Teose pisipildi allikas koos piiratud kogu HMAC-tokeniga.
 * Ühine kaardile (`WorkCard`) ja loendireale (`WorkListRow`); `url` vaikimisi kaanepilt.
 */
export function useWorkThumbnail(work: Work, url: string = work.thumbnail_url) {
  const { collections } = useCollection();
  const { authToken } = useUser();
  const [thumbnailSrc, setThumbnailSrc] = useState(url);
  const [thumbnailNeedsToken, setThumbnailNeedsToken] = useState(false);
  const thumbnailTokenTriedRef = React.useRef(false);

  React.useEffect(() => {
    setThumbnailSrc(url);
    setThumbnailNeedsToken(false);
    thumbnailTokenTriedRef.current = false;
  }, [url]);

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
        const sep = url.includes('?') ? '&' : '?';
        setThumbnailSrc(`${url}${sep}exp=${data.image_exp}&sig=${data.image_sig}`);
        setThumbnailNeedsToken(false);
      }
    } catch { /* thumbnail jääb placeholder-taustale */ }
  }, [authToken, work.work_id, url]);

  const isRestrictedWork = useMemo(() => {
    const workCollections = work.collections || [];
    if (workCollections.length === 0) return false;
    // Serveri loogika on "public wins": kui kasvõi üks teose otsene kollektsioon
    // on avalik, on pilt avalik. Kui kõik teadaolevad otsesed kollektsioonid on
    // restricted (ka privaatselt vanemalt päritult, #617), vajab <img> HMAC-tokenit.
    return workCollections.every(cid => isCollectionRestricted(collections, cid));
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
