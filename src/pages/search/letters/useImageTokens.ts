import { useEffect, useRef, useState } from 'react';
import { FILE_API_URL, IMAGE_BASE_URL } from '../../../config';
import type { LetterHit } from '../../../services/letterSearch';

/** Piiratud kogu pildid vajavad HMAC-tokenit (nagu Workspace'is); avalikul pole vaja. */
async function fetchImageTokenQuery(workId: string, authToken: string): Promise<string> {
  try {
    const r = await fetch(`${FILE_API_URL}/work/${workId}/viewer-token`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!r.ok) return '';
    const d = await r.json();
    return d?.image_exp && d?.image_sig ? `?exp=${d.image_exp}&sig=${d.image_sig}` : '';
  } catch {
    return '';
  }
}

export const letterThumbUrl = (workId: string, img: string, tokenQuery = '') =>
  `${IMAGE_BASE_URL}/${workId}/_thumbs/_thumb_${encodeURIComponent(img)}${tokenQuery}`;

/**
 * Pildi-token tulemuste MITTEAVALIKELE teostele (teos → `?exp=…&sig=…`).
 * Avalik teos ja väljalogitud kasutaja ei tee päringut. Vahemälu elab komponendi
 * eluea — token on kasutajapõhine, mitte moodulitasandil (ADR 0042).
 */
export function useImageTokens(hits: LetterHit[], authToken: string | null): Map<string, string> {
  const cache = useRef(new Map<string, Promise<string>>());
  const [tokens, setTokens] = useState(new Map<string, string>());
  const restricted = [...new Set(hits.filter(h => h.is_public === false).map(h => h.work_id))].sort().join(',');

  useEffect(() => {
    cache.current.clear();
    setTokens(new Map());
  }, [authToken]);

  useEffect(() => {
    if (!restricted || !authToken) return;
    let cancelled = false;
    const ids = restricted.split(',');
    Promise.all(ids.map(async id => {
      let p = cache.current.get(id);
      if (!p) {
        p = fetchImageTokenQuery(id, authToken);
        cache.current.set(id, p);
      }
      return [id, await p] as const;
    })).then(entries => {
      if (!cancelled) setTokens(new Map(entries.filter(([, q]) => q)));
    });
    return () => { cancelled = true; };
  }, [restricted, authToken]);

  return tokens;
}
