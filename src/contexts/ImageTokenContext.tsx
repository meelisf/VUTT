import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useUser } from './UserContext';
import { getViewerToken } from '../services/workApi';
import { ApiError } from '../services/apiClient';

/**
 * Piiratud kogu pildi HMAC-allkiri (`GET /work/{id}/viewer-token`, #673).
 *
 * Pildiserver on eraldi teenus ja `<img src>` ei kanna Authorization-päist,
 * seega käib allkiri URL-is (`?exp=…&sig=…`). Enne küsiti seda 7 kohas kolmel
 * viisil; nüüd käib iga küsimine siit.
 */
export interface ImageToken {
  exp: number;
  sig: string;
}

/** Allkiri on serveris 1 h; uus küsitakse enne, kui vana aegub. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const isFresh = (t: ImageToken) => t.exp * 1000 - Date.now() > REFRESH_MARGIN_MS;

/** `exp=…&sig=…` ilma eraldajata — kutsuja paneb `?` või `&`. */
export const imageTokenQuery = (t: ImageToken | null | undefined): string =>
  t ? `exp=${t.exp}&sig=${t.sig}` : '';

export function withImageToken(url: string, t: ImageToken | null | undefined): string {
  if (!t) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${imageTokenQuery(t)}`;
}

type Entry = Promise<ImageToken | null>;
type GetImageToken = (workId: string) => Entry;

const ImageTokenContext = createContext<GetImageToken | null>(null);

export const ImageTokenProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { authToken } = useUser();

  // Vahemälu elab konteksti eluea ja on seotud sessiooniga: allkiri sõltub
  // kasutaja õigustest, seega MITTE moodulitasandil (risti-kasutaja leke, ADR 0042).
  // Uus `authToken` (sisse/välja logimine, auth taastumine lehe laadimisel) annab
  // uue funktsiooni → tarbijate effectid küsivad uuesti.
  const get = useMemo<GetImageToken>(() => {
    const cache = new Map<string, { promise: Entry; token: ImageToken | null }>();
    return (workId: string) => {
      const hit = cache.get(workId);
      if (hit && (hit.token === null || isFresh(hit.token))) return hit.promise;
      const entry: { promise: Entry; token: ImageToken | null } = { promise: Promise.resolve(null), token: null };
      entry.promise = getViewerToken(workId, authToken)
        .then(d => {
          const token = d?.image_exp && d?.image_sig ? { exp: d.image_exp, sig: d.image_sig } : null;
          entry.token = token;
          return token;
        })
        .catch(err => {
          // Server ütleb päriselt „ei" (õigust/teost pole) → jääb meelde. Võrgutõrge
          // ei jää: järgmine küsimine proovib uuesti.
          const definitive = err instanceof ApiError && [401, 403, 404].includes(err.status);
          if (!definitive && cache.get(workId) === entry) cache.delete(workId);
          return null;
        });
      cache.set(workId, entry);
      return entry.promise;
    };
  }, [authToken]);

  return <ImageTokenContext.Provider value={get}>{children}</ImageTokenContext.Provider>;
};

export function useImageTokenFetcher(): GetImageToken {
  const ctx = useContext(ImageTokenContext);
  if (!ctx) throw new Error('useImageTokenFetcher peab olema ImageTokenProvider-i sees');
  return ctx;
}

/**
 * Teose pildiallkiri; `null`, kuni seda pole (või `enabled` on väljas).
 * `refresh` küsib uue enne aegumist — ainult pika eluga vaatele, mis paneb
 * allkirja ise src-i (teose haldus). Töölaud seda EI kasuta: uus allkiri muudaks
 * suure pildi src-i ja laeks selle keset tööd uuesti.
 */
export function useImageToken(
  workId: string | undefined,
  { enabled = true, refresh = false }: { enabled?: boolean; refresh?: boolean } = {},
): ImageToken | null {
  const get = useImageTokenFetcher();
  const [state, setState] = useState<{ get: GetImageToken; workId: string; token: ImageToken } | null>(null);

  useEffect(() => {
    if (!workId || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      void get(workId).then(token => {
        if (cancelled) return;
        setState(token ? { get, workId, token } : null);
        if (token && refresh) {
          timer = setTimeout(load, Math.max(token.exp * 1000 - Date.now() - REFRESH_MARGIN_MS, 60_000));
        }
      });
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [get, workId, enabled, refresh]);

  // Teise teose või eelmise sessiooni allkirja ei näidata ka vahepeal, kuni uus tuleb.
  return state && state.workId === workId && state.get === get ? state.token : null;
}
