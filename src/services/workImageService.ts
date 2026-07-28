/**
 * Piltide ja thumbnailide URL-abifunktsioonid
 */

import { IMAGE_BASE_URL } from '../config';

// Abifunktsioon pildi täis-URL-i ehitamiseks
export const getFullImageUrl = (imagePath: string): string => {
  if (!imagePath) return '';
  const cleanPath = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
  return `${IMAGE_BASE_URL}/${encodeURI(cleanPath)}`;
};

// Dashboardi kaanepildi versioon — peab kattuma image_server.py COVER_VERSION-iga.
// URL on stabiilne (/{work_id}/_thumb) ja pildid on 30 päeva brauseri-cache'is, seega
// serveripoolsest failinime-versioonist üksi ei piisa: ilma ?v-ta näeks olemasolev
// kasutaja vana 560 px pilti kuni cache aegumiseni.
const COVER_VERSION = 2;

// Kaanepildi URL konstrueerimine (server leiab ise õige faili)
export const getThumbUrl = (workId: string): string => {
  if (!workId) return '';
  return `${IMAGE_BASE_URL}/${workId}/_thumb?v=${COVER_VERSION}`;
};

// Lehekülje thumbnaili URL (_thumbs/ alamkataloogist)
export const getPageThumbUrl = (workId: string, imagePath: string): string => {
  if (!workId || !imagePath) return '';
  const filename = imagePath.split('/').pop() || '';
  return `${IMAGE_BASE_URL}/${workId}/_thumbs/_thumb_${filename}`;
};
