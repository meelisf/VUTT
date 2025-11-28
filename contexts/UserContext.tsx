import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { FILE_API_URL } from '../config';

interface User {
  username: string;
  name: string;
  role: string;
}

interface UserContextType {
  user: User | null;
  authToken: string | null;  // Sessioonitõend API päringute jaoks
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const STORAGE_KEY = 'vutt_user';
const TOKEN_KEY = 'vutt_token';

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Tokeni verifitseerimine serverist
  const verifyToken = async (token: string): Promise<User | null> => {
    try {
      const response = await fetch(`${FILE_API_URL}/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await response.json();
      if (data.status === 'success' && data.valid && data.user) {
        return data.user;
      }
      return null;
    } catch (e) {
      console.error('Token verification failed:', e);
      return null;
    }
  };

  // Lae kasutaja ja token localStorage'ist ning verifitseeri
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(STORAGE_KEY);
      
      if (storedToken && storedUser) {
        // Kontrolli, kas token on veel kehtiv
        const verifiedUser = await verifyToken(storedToken);
        if (verifiedUser) {
          setUser(verifiedUser);
          setAuthToken(storedToken);
        } else {
          // Token aegunud, kustuta localStorage
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setIsLoading(false);
    };
    initAuth();
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`${FILE_API_URL}/login`, {
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
    setAuthToken(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
  };

  return (
    <UserContext.Provider value={{ user, authToken, login, logout, isLoading }}>
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
