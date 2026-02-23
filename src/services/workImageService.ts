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

// Thumbnaili URL konstrueerimine (server leiab ise õige faili)
export const getThumbUrl = (workId: string): string => {
  if (!workId) return '';
  return `${IMAGE_BASE_URL}/${workId}/_thumb`;
};

// Lehekülje thumbnaili URL (_thumbs/ alamkataloogist)
export const getPageThumbUrl = (workId: string, imagePath: string): string => {
  if (!workId || !imagePath) return '';
  const filename = imagePath.split('/').pop() || '';
  return `${IMAGE_BASE_URL}/${workId}/_thumbs/_thumb_${filename}`;
};
