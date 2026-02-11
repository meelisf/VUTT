import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { getCollections, Collections, Collection } from '../services/collectionService';

interface CollectionContextType {
  // Valitud kollektsiooni ID (null = kõik tööd)
  selectedCollection: string | null;
  setSelectedCollection: (id: string | null) => void;

  // Kollektsioonide andmed
  collections: Collections;
  isLoading: boolean;

  // Abifunktsioonid
  getCollectionName: (id: string, lang?: 'et' | 'en') => string;
  getCollectionPath: (id: string, lang?: 'et' | 'en') => string[];
}

const CollectionContext = createContext<CollectionContextType | undefined>(undefined);

const STORAGE_KEY = 'vutt_collection';

export const CollectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedCollection, setSelectedCollectionState] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collections>({});
  const [isLoading, setIsLoading] = useState(true);

  // Lae kollektsioonid ja taasta valik localStorage'ist
  useEffect(() => {
    const init = async () => {
      try {
        const data = await getCollections();
        setCollections(data);

        // Taasta valik localStorage'ist
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && data[stored]) {
          setSelectedCollectionState(stored);
        }
      } catch (e) {
        console.error('Failed to load collections:', e);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  // Salvesta valik localStorage'i
  const setSelectedCollection = useCallback((id: string | null) => {
    setSelectedCollectionState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Tagasta kollektsiooni nimi keele järgi
  const getCollectionName = useCallback((id: string, lang: 'et' | 'en' = 'et'): string => {
    const collection = collections[id];
    if (!collection) return id;
    return collection.name[lang] || collection.name.et || id;
  }, [collections]);

  // Tagasta kollektsiooni hierarhia nimede massiivina
  const getCollectionPath = useCallback((id: string, lang: 'et' | 'en' = 'et'): string[] => {
    const path: string[] = [];
    let currentId: string | undefined = id;

    while (currentId) {
      const collection = collections[currentId];
      if (collection) {
        path.unshift(collection.name[lang] || collection.name.et);
        currentId = collection.parent;
      } else {
        break;
      }
    }

    return path;
  }, [collections]);

  const value = useMemo(() => ({
    selectedCollection,
    setSelectedCollection,
    collections,
    isLoading,
    getCollectionName,
    getCollectionPath
  }), [selectedCollection, setSelectedCollection, collections, isLoading, getCollectionName, getCollectionPath]);

  return (
    <CollectionContext.Provider value={value}>
      {children}
    </CollectionContext.Provider>
  );
};

export const useCollection = () => {
  const context = useContext(CollectionContext);
  if (context === undefined) {
    throw new Error('useCollection must be used within a CollectionProvider');
  }
  return context;
};
