import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { MeiliSearch, Index } from 'meilisearch';
import { MEILI_HOST, MEILI_INDEX } from '../config';
import { CHECK_INTERVAL_MS, resolveTokenExpiresAt, shouldRefreshOrPromote } from '../utils/meiliTokenRefresh';

const SESSION_TOKEN_KEY = 'vutt_token';

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
        tokenExpiresAt.current = resolveTokenExpiresAt(token);
        isUserToken.current = false;
      }
    } catch (e) {
      console.error('Meili anonüümse tokeni laadimine ebaõnnestus', e);
    }
  }, []);

  // Kasutaja-tokeni värskendus/promotion. KRIITILINE: sessiooni olemasolu localStorage'is
  // (mitte `isUserToken.current`) on tõeallikas. See katab KAKS juhtu:
  //   1. Transientne viga EI TOHI degradeerida sisseloginud tabi anonüümseks (võrgu-blip,
  //      5xx/502 redeploy ajal, 429, tühi token) — ainult 401 (sessioon päriselt aegunud)
  //      degradeerib anon-iks; transientne säilitab olemasoleva tokeni ja proovib uuesti.
  //   2. PROMOTION: kui index on juba anon-iks degradeerunud (nt taustatabis öö läbi), aga
  //      sessioon on endiselt kehtiv, promoteeri tagasi user-tokeniks. Varasem bug: kord
  //      anon-iks läinud index ei taastunud KUNAGI ilma full reloadita (initAuth) → piiratud
  //      kollektsioon andis "teoseid ei leitud", kuigi päis näitas sisseloginud kasutajat.
  const refreshToken = useCallback(async () => {
    const sessionToken = localStorage.getItem(SESSION_TOKEN_KEY) || '';
    if (sessionToken) {
      try {
        const r = await fetch('/api/files/api/meili-token/refresh', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (r.ok) {
          const { token } = await r.json();
          if (token) {
            setIndex(makeIndex(token));
            tokenExpiresAt.current = resolveTokenExpiresAt(token);
            isUserToken.current = true;
            return;
          }
          // ok aga tühi token — transientne, säilita olemasolev index.
          return;
        }
        // 401 = sessioon päriselt aegunud → degradeeri anon-iks.
        if (r.status === 401) {
          await fetchAnonToken();
          return;
        }
        // Muu viga (5xx/429) on transientne — säilita olemasolev index, proovi hiljem.
        return;
      } catch {
        // Võrgu-blip — transientne, säilita olemasolev index, proovi hiljem uuesti.
        return;
      }
    }
    // Sessiooni pole → anonüümne token.
    await fetchAnonToken();
  }, [fetchAnonToken]);

  const setUserToken = useCallback((token: string) => {
    setIndex(makeIndex(token));
    tokenExpiresAt.current = resolveTokenExpiresAt(token);
    isUserToken.current = true;
  }, []);

  const clearUserToken = useCallback(() => {
    isUserToken.current = false;
    fetchAnonToken();
  }, [fetchAnonToken]);

  useEffect(() => {
    // Sessiooniga: lae KASUTAJA-token kohe (väldib võidujooksu UserContext.initAuth-iga,
    // kus hiljem resolvuv anon-fetch kirjutaks user-tokeni üle → index jääks anon).
    // Ilma sessioonita: anonüümne token.
    if (localStorage.getItem(SESSION_TOKEN_KEY)) {
      refreshToken();
    } else {
      fetchAnonToken();
    }
  }, [refreshToken, fetchAnonToken]);

  useEffect(() => {
    const maybeRefresh = () => {
      const hasSession = !!localStorage.getItem(SESSION_TOKEN_KEY);
      if (shouldRefreshOrPromote(Date.now(), tokenExpiresAt.current, hasSession, isUserToken.current)) {
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
