import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPartsToc } from '../../services/workPartsApi';
import type { SourcePartsMap } from '../utils/personSources';

/** Allikakirjetes viidatud osade sildid ja esimesed lehed (ADR 0078).
 *  Ligipääsuta või kadunud teos jääb kaardist välja → kuvatakse ainult teos. */
export function useSourceParts(workIds: string[], token?: string | null): SourcePartsMap {
  const { t } = useTranslation('workspace');
  const key = [...new Set(workIds)].sort().join('|');
  const [map, setMap] = useState<SourcePartsMap>({});
  useEffect(() => {
    if (!key) { setMap({}); return; }
    let alive = true;
    void Promise.all(key.split('|').map(workId =>
      getPartsToc(workId, token || null)
        .then(({ parts, pageNumbers }) => [workId, Object.fromEntries(parts.map(part => {
          const numbers = part.pages.map(stem => pageNumbers[stem]).filter((n): n is number => Boolean(n));
          return [part.id, {
            kindLabel: t(`manage.parts.kinds.${part.kind}`, { defaultValue: part.kind }),
            title: part.title || null,
            firstPage: numbers.length ? Math.min(...numbers) : null,
          }];
        }))] as const)
        .catch(() => null)))
      .then(entries => {
        if (alive) setMap(Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => e !== null)));
      });
    return () => { alive = false; };
  }, [key, token, t]);
  return map;
}
