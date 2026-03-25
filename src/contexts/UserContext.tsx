import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import i18n from '../i18n';

export interface UserPreferences {
  language?: 'et' | 'en';
  default_tab?: 'edit' | 'annotate';
  custom_characters?: Array<{ char: string; name: string }>;
}

interface User {
  username: string;
  name: string;
  role: string;
  preferences?: UserPreferences;
}

interface UserContextType {
  user: User | null;
  authToken: string | null;  // Sessioonitõend API päringute jaoks
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isLoading: boolean;
  sessionExpired: boolean;
  clearSessionExpired: () => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<boolean>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const STORAGE_KEY = 'vutt_user';
const TOKEN_KEY = 'vutt_token';

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const tokenCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tokeni verifitseerimine serverist
  // Tagastab: User (kehtiv) | null (server ütles aegunud) | 'network-error' (võrguviga, ärge logige välja)
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

  // Rakenda kasutaja eelistused (keel jne)
  const applyPreferences = useCallback((prefs?: UserPreferences) => {
    if (!prefs) return;
    if (prefs.language && prefs.language !== i18n.language) {
      i18n.changeLanguage(prefs.language);
    }
  }, []);

  // Lae kasutaja ja token localStorage'ist ning verifitseeri
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(STORAGE_KEY);

      if (storedToken && storedUser) {
        // Kontrolli, kas token on veel kehtiv
        const verifiedUser = await verifyToken(storedToken);
        if (verifiedUser && verifiedUser !== 'network-error') {
          setUser(verifiedUser);
          setAuthToken(storedToken);
          applyPreferences(verifiedUser.preferences);
        } else if (verifiedUser === 'network-error') {
          // Võrguviga käivitusel — laadime localStorage'ist (optimistlik)
          try {
            const parsedUser = JSON.parse(storedUser);
            setUser(parsedUser);
            setAuthToken(storedToken);
            applyPreferences(parsedUser.preferences);
          } catch {}
        } else {
          // Server kinnitas et token on aegunud
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

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
        // Server kinnitas et token on aegunud — logi välja
        setUser(null);
        setAuthToken(null);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(STORAGE_KEY);
        setSessionExpired(true);
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
        // Salvestame tokeni localStorage'i (mitte parooli!)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user));
        localStorage.setItem(TOKEN_KEY, data.token);
        // Rakenda kasutaja eelistused
        applyPreferences(data.user.preferences);
        return { success: true };
      } else {
        return { success: false, error: data.message || 'Sisselogimine ebaõnnestus' };
      }
    } catch (e: any) {
      console.error('Login error:', e);
      return { success: false, error: 'Serveriga ühendamine ebaõnnestus' };
    }
  }, [applyPreferences]);

  const logout = useCallback(() => {
    setUser(null);
    setAuthToken(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  const updatePreferences = useCallback(async (prefs: Partial<UserPreferences>): Promise<boolean> => {
    if (!authToken || !user) return false;
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/user-prefs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(prefs)
      });
      const data = await response.json();
      if (data.status === 'success') {
        // Uuenda lokaalne user objekt
        const updatedUser = { ...user, preferences: { ...user.preferences, ...prefs } };
        setUser(updatedUser);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedUser));
        // Rakenda koheselt
        applyPreferences(prefs as UserPreferences);
        return true;
      }
      return false;
    } catch (e) {
      console.error('updatePreferences error:', e);
      return false;
    }
  }, [authToken, user, applyPreferences]);

  const value = useMemo(() => ({
    user, authToken, login, logout, isLoading, sessionExpired, clearSessionExpired, updatePreferences
  }), [user, authToken, login, logout, isLoading, sessionExpired, clearSessionExpired, updatePreferences]);

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
