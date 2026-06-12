import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { MeiliSearch, Index } from 'meilisearch';
import { MEILI_HOST, MEILI_INDEX } from '../config';
import { TOKEN_TTL_MS, CHECK_INTERVAL_MS, shouldRefreshToken } from '../utils/meiliTokenRefresh';

interface MeilisearchContextValue {
  index: Index | null;
  setUserToken: (token: string) => void;
  clearUserToken: () => void;
}

const MeilisearchContext = createContext<MeilisearchContextValue>({
  index: null,
  setUserToken: () => {},
  clearUserToken: () => {},
});

function makeIndex(token: string): Index {
  return new MeiliSearch({ host: MEILI_HOST, apiKey: token }).index(MEILI_INDEX);
}

export function MeilisearchProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<Index | null>(null);
  const tokenExpiresAt = useRef<number>(0);
  const isUserToken = useRef(false);

  const fetchAnonToken = useCallback(async () => {
    try {
      const r = await fetch('/api/files/api/meili-token');
      const { token } = await r.json();
      if (token) {
        setIndex(makeIndex(token));
        tokenExpiresAt.current = Date.now() + TOKEN_TTL_MS;
        isUserToken.current = false;
      }
    } catch (e) {
      console.error('Meili anonüümse tokeni laadimine ebaõnnestus', e);
    }
  }, []);

  const refreshToken = useCallback(async () => {
    if (isUserToken.current) {
      try {
        const sessionToken = localStorage.getItem('vutt_token') || '';
        const r = await fetch('/api/files/api/meili-token/refresh', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (r.ok) {
          const { token } = await r.json();
          if (token) {
            setIndex(makeIndex(token));
            tokenExpiresAt.current = Date.now() + TOKEN_TTL_MS;
            return;
          }
        }
      } catch {}
    }
    await fetchAnonToken();
  }, [fetchAnonToken]);

  const setUserToken = useCallback((token: string) => {
    setIndex(makeIndex(token));
    tokenExpiresAt.current = Date.now() + TOKEN_TTL_MS;
    isUserToken.current = true;
  }, []);

  const clearUserToken = useCallback(() => {
    isUserToken.current = false;
    fetchAnonToken();
  }, [fetchAnonToken]);

  useEffect(() => {
    fetchAnonToken();
  }, [fetchAnonToken]);

  useEffect(() => {
    const maybeRefresh = () => {
      if (shouldRefreshToken(Date.now(), tokenExpiresAt.current)) {
        refreshToken();
      }
    };
    // Taustatabis/unerežiimis taimerid ei jookse — kontrolli ka fookusesse tulekul
    const onVisible = () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    };
    const id = setInterval(maybeRefresh, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshToken]);

  return (
    <MeilisearchContext.Provider value={{ index, setUserToken, clearUserToken }}>
      {children}
    </MeilisearchContext.Provider>
  );
}

export function useMeiliIndex(): Index | null {
  return useContext(MeilisearchContext).index;
}

export function useMeilisearch(): MeilisearchContextValue {
  return useContext(MeilisearchContext);
}
