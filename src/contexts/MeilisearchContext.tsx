import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { MeiliSearch, Index } from 'meilisearch';
import { MEILI_HOST, MEILI_INDEX } from '../config';

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
        tokenExpiresAt.current = Date.now() + 60 * 60 * 1000;
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
            tokenExpiresAt.current = Date.now() + 60 * 60 * 1000;
            return;
          }
        }
      } catch {}
    }
    await fetchAnonToken();
  }, [fetchAnonToken]);

  const setUserToken = useCallback((token: string) => {
    setIndex(makeIndex(token));
    tokenExpiresAt.current = Date.now() + 60 * 60 * 1000;
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
    const id = setInterval(() => {
      if (Date.now() > tokenExpiresAt.current - 60_000) {
        refreshToken();
      }
    }, 55 * 60 * 1000);
    return () => clearInterval(id);
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
