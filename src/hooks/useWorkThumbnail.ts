import React, { useMemo, useState } from 'react';
import { Work } from '../types';
import { useCollection } from '../contexts/CollectionContext';
import { useUser } from '../contexts/UserContext';
import { useImageTokenFetcher, withImageToken } from '../contexts/ImageTokenContext';
import { isCollectionRestricted } from '../services/collectionService';

/**
 * Teose pisipildi allikas koos piiratud kogu HMAC-tokeniga.
 * Ühine kaardile (`WorkCard`) ja loendireale (`WorkListRow`); `url` vaikimisi kaanepilt.
 */
export function useWorkThumbnail(work: Work, url: string = work.thumbnail_url) {
  const { collections } = useCollection();
  const { authToken } = useUser();
  const getImageToken = useImageTokenFetcher();
  const [thumbnailSrc, setThumbnailSrc] = useState(url);
  const [thumbnailNeedsToken, setThumbnailNeedsToken] = useState(false);

  React.useEffect(() => {
    setThumbnailSrc(url);
    setThumbnailNeedsToken(false);
  }, [url]);

  const isRestrictedWork = useMemo(() => {
    const workCollections = work.collections || [];
    if (workCollections.length === 0) return false;
    // Serveri loogika on "public wins": kui kasvõi üks teose otsene kollektsioon
    // on avalik, on pilt avalik. Kui kõik teadaolevad otsesed kollektsioonid on
    // restricted (ka privaatselt vanemalt päritult, #617), vajab <img> HMAC-tokenit.
    return workCollections.every(cid => isCollectionRestricted(collections, cid));
  }, [collections, work.collections]);

  // Allkirja küsitakse ainult sisselogituna. Auth taastub lehe laadimisel
  // asünkroonselt: kui 403 jõuab enne `authToken`-it, käivitab tokeni saabumine
  // (uus `getImageToken`) selle effecti uuesti. Vahemälu on ühine (#673) —
  // sama teose kaart ja loendirida ei küsi kaks korda.
  React.useEffect(() => {
    if (!work.work_id || !authToken || !(thumbnailNeedsToken || isRestrictedWork)) return;
    let cancelled = false;
    void getImageToken(work.work_id).then(token => {
      if (!cancelled && token) setThumbnailSrc(withImageToken(url, token));
    });
    return () => { cancelled = true; };
  }, [thumbnailNeedsToken, isRestrictedWork, getImageToken, authToken, work.work_id, url]);

  const handleThumbnailError = () => setThumbnailNeedsToken(true);

  return { thumbnailSrc, handleThumbnailError };
}
