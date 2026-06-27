import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import i18n from '../i18n';
import { useMeilisearch } from './MeilisearchContext';

export interface UserSettings {
  language?: 'et' | 'en';
  default_tab?: 'edit' | 'annotate';
  characters?: Array<{ char: string; name: string }>;
}

interface User {
  username: string;
  name: string;
  role: string;
  allowed_collections?: string[];
}

interface UserContextType {
  user: User | null;
  authToken: string | null;
  userSettings: UserSettings;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isLoading: boolean;
  sessionExpired: boolean;
  clearSessionExpired: () => void;
  updateSettings: (settings: Partial<UserSettings>) => Promise<boolean>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const STORAGE_KEY = 'vutt_user';
const TOKEN_KEY = 'vutt_token';
const SETTINGS_KEY = 'vutt_settings';

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { setUserToken, clearUserToken } = useMeilisearch();
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings>({});
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const tokenCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tokeni verifitseerimine serverist
  const verifyToken = async (token: string): Promise<User | null | 'network-error'> => {
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        timeout: 5000
      });
      const data = await response.json();
      if (data.status === 'success' && data.valid && data.user) {
        return data.user;
      }
      return null;
    } catch (e) {
      console.error('Token verification failed (network error):', e);
      return 'network-error';
    }
  };

  // Lae kasutaja seaded serverist
  const loadUserSettings = async (token: string): Promise<UserSettings> => {
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/user-settings`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 5000
      });
      const data = await response.json();
      if (data.status === 'success' && data.settings) {
        return data.settings;
      }
    } catch (e) {
      console.warn('User settings load failed:', e);
    }
    return {};
  };

  // Rakenda kasutaja eelistused (keel jne)
  const applySettings = useCallback((settings: UserSettings) => {
    if (settings.language && settings.language !== i18n.language) {
      i18n.changeLanguage(settings.language);
    }
  }, []);

  // Lae kasutaja ja token localStorage'ist ning verifitseeri
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(STORAGE_KEY);
      const storedSettings = localStorage.getItem(SETTINGS_KEY);

      if (storedToken && storedUser) {
        const verifiedUser = await verifyToken(storedToken);
        if (verifiedUser && verifiedUser !== 'network-error') {
          setUser(verifiedUser);
          setAuthToken(storedToken);
          // Taasta Meilisearchi kasutaja token (ilma selleta kasutatakse anonüümset filtrit)
          try {
            const mr = await fetch(`${FILE_API_URL}/api/meili-token/refresh`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${storedToken}` },
            });
            if (mr.ok) {
              const { token: meiliToken } = await mr.json();
              if (meiliToken) setUserToken(meiliToken);
            }
          } catch {}
          // Lae seaded serverist
          const settings = await loadUserSettings(storedToken);
          setUserSettings(settings);
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
          applySettings(settings);
        } else if (verifiedUser === 'network-error') {
          // Võrguviga — kasuta localStorage'i
          try {
            setUser(JSON.parse(storedUser));
            setAuthToken(storedToken);
            const settings = storedSettings ? JSON.parse(storedSettings) : {};
            setUserSettings(settings);
            applySettings(settings);
          } catch {}
        } else {
          // LocalStorage'is oli token, kuid server ütles, et see enam ei kehti.
          // Jätame põhjuse alles, et piiratud vaated saaksid pakkuda uuesti sisselogimist.
          setSessionExpired(true);
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(SETTINGS_KEY);
        }
      }
      setIsLoading(false);
    };
    initAuth();
  }, [applySettings]);

  // Perioodiline tokeni kontroll (iga 5 min)
  useEffect(() => {
    // Puhasta eelmine intervall
    if (tokenCheckRef.current) {
      clearInterval(tokenCheckRef.current);
      tokenCheckRef.current = null;
    }

    // Käivita ainult kui kasutaja on sisse logitud
    if (!authToken || !user) return;

    tokenCheckRef.current = setInterval(async () => {
      const result = await verifyToken(authToken);
      if (result === 'network-error') {
        // Võrguviga — ära logi välja, proovi järgmisel korral uuesti
        console.warn('Token check: võrguviga, jätkan sessiooni');
        return;
      }
      if (!result) {
        // Server kinnitas, et token on aegunud — degradeeri anonüümseks,
        // kuid jäta UI-le teadmine, et põhjus oli sessiooni aegumine.
        // NB: sessionExpired EI tohi avada globaalset blokeerivat modaali;
        // vaated kasutavad seda kontekstipõhiselt (nt piiratud teose juures
        // näidatakse "logi uuesti sisse", avalik sisu jääb kättesaadavaks).
        setSessionExpired(true);
        setUser(null);
        setAuthToken(null);
        clearUserToken();
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(STORAGE_KEY);
      }
    }, 5 * 60 * 1000); // 5 minutit

    return () => {
      if (tokenCheckRef.current) {
        clearInterval(tokenCheckRef.current);
        tokenCheckRef.current = null;
      }
    };
  }, [authToken, user]);

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      
      if (data.status === 'success' && data.user && data.token) {
        setUser(data.user);
        setAuthToken(data.token);
        setSessionExpired(false);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user));
        localStorage.setItem(TOKEN_KEY, data.token);
        if (data.meili_token) {
          setUserToken(data.meili_token);
        }
        // Lae kasutaja seaded serverist
        const settings = await loadUserSettings(data.token);
        setUserSettings(settings);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        applySettings(settings);
        return { success: true };
      } else {
        return { success: false, error: data.message || 'Sisselogimine ebaõnnestus' };
      }
    } catch (e: any) {
      console.error('Login error:', e);
      return { success: false, error: 'Serveriga ühendamine ebaõnnestus' };
    }
  }, [applySettings, setUserToken]);

  const logout = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      // Tühista sessioon serveris (best-effort, ei blokeeri)
      fetch(`${FILE_API_URL}/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      }).catch(() => {});
    }
    setUser(null);
    setAuthToken(null);
    setSessionExpired(false);
    clearUserToken();
    setUserSettings({});
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SETTINGS_KEY);
  }, [clearUserToken]);

  const updateSettings = useCallback(async (newSettings: Partial<UserSettings>): Promise<boolean> => {
    if (!authToken || !user) return false;
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/user-settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(newSettings)
      });
      const data = await response.json();
      if (data.status === 'success') {
        const updated = { ...userSettings, ...newSettings };
        setUserSettings(updated);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
        applySettings(newSettings as UserSettings);
        return true;
      }
      return false;
    } catch (e) {
      console.error('updateSettings error:', e);
      return false;
    }
  }, [authToken, user, userSettings, applySettings]);

  const value = useMemo(() => ({
    user, authToken, userSettings, login, logout, isLoading, sessionExpired, clearSessionExpired, updateSettings
  }), [user, authToken, userSettings, login, logout, isLoading, sessionExpired, clearSessionExpired, updateSettings]);

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
