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
// URL on stabiilne (/{work_id}/_thumb); brauser revalideerib pilte Last-Modified'i järgi
// (`max-age=0, must-revalidate` / `private, no-cache`, image_server.py). ?v vahetab
// versioonimuutusel URL-i, et uus kuju ei sõltuks revalideerimise tulemusest.
const COVER_VERSION = 2;

/**
 * Lehe failinimi (kettal olev kuju) pildi URL-ist. `getFullImageUrl` kodeerib
 * tee `encodeURI`-ga, seega URL-i viimane lõik on „Lieffl%C3%A4…", mitte
 * „Liefflä…". Serveri teed (/save, ajalugu, re-OCR) vajavad kettal olevat
 * nime — ilma dekodeerimiseta 404 iga mitte-ASCII failinime korral.
 */
export const pageFileFromImageUrl = (imageUrl: string): string => {
  const last = (imageUrl || '').split('/').pop() || '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last; // vigane %-jada: parem toores nimi kui erind salvestusteel
  }
};

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

// Eksemplari pilt ja pisipilt (ADR 0079). Piiratud teosel lisab kutsuja allkirja
// (`withImageToken`), nagu lehepiltidel.
export const getExemplarImageUrl = (workId: string, eid: string, imageId: string): string =>
  `${IMAGE_BASE_URL}/${workId}/_exemplars/${eid}/${imageId}.jpg`;

export const getExemplarThumbUrl = (workId: string, eid: string, imageId: string): string =>
  `${IMAGE_BASE_URL}/${workId}/_exemplars/${eid}/_thumbs/_thumb_${imageId}.jpg`;
