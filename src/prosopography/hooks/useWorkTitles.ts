import { useEffect, useMemo, useState } from 'react';
import { getWorkTitles } from '../services/prosopographyService';

export interface WorkInfo { title: string; year: number | null }

/** Teoste pealkiri + aasta. Server annab pealkirja ka kaitstud teosele;
 *  puuduv kirje → kutsuja näitab work_id-d. */
export function useWorkInfo(workIds: string[], token?: string): Record<string, WorkInfo> {
  const key = [...new Set(workIds)].sort().join('|');
  const [info, setInfo] = useState<Record<string, WorkInfo>>({});
  useEffect(() => {
    if (!key) { setInfo({}); return; }
    let alive = true;
    void getWorkTitles(key.split('|'), token).then(map => {
      if (alive) setInfo(Object.fromEntries(Object.entries(map).map(
        ([id, w]) => [id, { title: w.title || id, year: w.year ?? null }])));
    });
    return () => { alive = false; };
  }, [key, token]);
  return info;
}

/** Ainult pealkirjad — kui `useWorkInfo` vastus on juba käes (üks päring mõlemale). */
export function titlesOf(info: Record<string, WorkInfo>): Record<string, string> {
  return Object.fromEntries(Object.entries(info).map(([id, w]) => [id, w.title]));
}

/** Teoste pealkirjad tõendiviidetele. */
export function useWorkTitles(workIds: string[], token?: string): Record<string, string> {
  const info = useWorkInfo(workIds, token);
  // Stabiilne viide: kutsujad võivad tulemust effecti sõltuvusena kasutada.
  return useMemo(() => titlesOf(info), [info]);
}
