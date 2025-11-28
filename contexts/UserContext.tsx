import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { FILE_API_URL } from '../config';

interface User {
  username: string;
  name: string;
  role: string;
}

// Autentimisandmed API päringute jaoks (ei salvestata localStorage'i)
interface AuthCredentials {
  username: string;
  password: string;
}

interface UserContextType {
  user: User | null;
  authCredentials: AuthCredentials | null;  // Lisatud API autentimiseks
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const STORAGE_KEY = 'vutt_user';

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authCredentials, setAuthCredentials] = useState<AuthCredentials | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load user from localStorage on mount
  // NB: Parooli ei laeta localStorage'ist turvakaalutlustel
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setUser(JSON.parse(stored));
        // Kasutaja peab uuesti sisse logima, et saada API ligipääs
      } catch (e) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${FILE_API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      
      if (data.status === 'success' && data.user) {
        setUser(data.user);
        // Salvestame autentimisandmed mällu (API päringute jaoks)
        setAuthCredentials({ username, password });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user));
        return { success: true };
      } else {
        return { success: false, error: data.message || 'Sisselogimine ebaõnnestus' };
      }
    } catch (e: any) {
      console.error('Login error:', e);
      return { success: false, error: 'Serveriga ühendamine ebaõnnestus' };
    }
  };

  const logout = () => {
    setUser(null);
    setAuthCredentials(null);  // Kustutame ka autentimisandmed
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <UserContext.Provider value={{ user, authCredentials, login, logout, isLoading }}>
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
