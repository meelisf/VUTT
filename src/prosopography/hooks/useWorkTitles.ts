import { useEffect, useState } from 'react';
import { getWorkTitles } from '../services/prosopographyService';

/** Teoste pealkirjad tõendiviidetele. Server annab pealkirja ka kaitstud teosele;
 *  puuduv pealkiri → kutsuja näitab work_id-d. */
export function useWorkTitles(workIds: string[], token?: string): Record<string, string> {
  const key = [...new Set(workIds)].sort().join('|');
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) { setTitles({}); return; }
    let alive = true;
    void getWorkTitles(key.split('|'), token).then(map => {
      if (alive) setTitles(Object.fromEntries(Object.entries(map).map(([id, info]) => [id, info.title || id])));
    });
    return () => { alive = false; };
  }, [key, token]);
  return titles;
}
