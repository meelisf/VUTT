/**
 * Samanimelised isikud kogu VUTT-ist (ADR 0082 p 4): isikuleht ja vorm näitavad
 * vihjet, et toimetaja lisaks eristava täiendi. Ainult kuvamiseks — tõrge annab
 * tühja loendi, mitte veateate.
 */
import { useEffect, useState } from 'react';
import { listPersons } from '../services/prosopographyService';
import { sameNamePersons } from '../utils/distinguishing';
import type { ProsopoIndexEntry } from '../types';

const DEBOUNCE_MS = 400;

export function useSameNamePersons(
  label: string,
  excludeId: string | null | undefined,
  token?: string,
): ProsopoIndexEntry[] {
  const [matches, setMatches] = useState<ProsopoIndexEntry[]>([]);

  useEffect(() => {
    const q = label.trim();
    if (q.length < 3) { setMatches([]); return; }
    let tyhistatud = false;
    const timer = setTimeout(() => {
      listPersons({ q, limit: 50 }, token)
        .then(r => { if (!tyhistatud) setMatches(sameNamePersons(q, r.results ?? [], excludeId)); })
        .catch(() => { if (!tyhistatud) setMatches([]); });
    }, DEBOUNCE_MS);
    return () => { tyhistatud = true; clearTimeout(timer); };
  }, [label, excludeId, token]);

  return matches;
}
