import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { getCollections, Collections } from '../services/collectionService';
import { COLLECTION_PARAM, resolveInitialCollection } from './collectionUrl';

interface CollectionContextType {
  // Valitud kollektsiooni ID (null = kõik tööd)
  selectedCollection: string | null;
  setSelectedCollection: (id: string | null) => void;

  // Kollektsioonide andmed
  collections: Collections;
  isLoading: boolean;

  // Laadib kollektsioonid uuesti (nt pärast admin muudatusi)
  refreshCollections: () => Promise<void>;

  // Abifunktsioonid
  getCollectionName: (id: string, lang?: 'et' | 'en') => string;
  getCollectionPath: (id: string, lang?: 'et' | 'en') => string[];
}

const CollectionContext = createContext<CollectionContextType | undefined>(undefined);

const STORAGE_KEY = 'vutt_collection';
const DEFAULT_COLLECTION = 'universitas-dorpatensis-1';

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

        // URL > localStorage > vaikekogu (#323). URL loetakse `window.location`-ist,
        // mitte `useSearchParams`-ist: provider istub Routerist väljaspool ja see
        // on ühekordne algväärtus, mitte jooksev sünkroniseerimine.
        const stored = localStorage.getItem(STORAGE_KEY);
        const fromUrl = new URLSearchParams(window.location.search).get(COLLECTION_PARAM);
        const initial = resolveInitialCollection(fromUrl, stored, data, DEFAULT_COLLECTION);
        setSelectedCollectionState(initial);
        // Lingiga tulnud valik jääb kehtima ka edasi — sama, mis oleks
        // kogu käsitsi valimine. Ilma selleta hüppaks järgmine leht tagasi.
        if (fromUrl && initial !== stored) {
          if (initial) localStorage.setItem(STORAGE_KEY, initial);
          else localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {
        console.error('Failed to load collections:', e);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  // Laadib kollektsioonid uuesti (nt pärast admin muudatusi)
  const refreshCollections = useCallback(async () => {
    try {
      const data = await getCollections(true); // forceRefresh
      setCollections(data);
    } catch (e) {
      console.error('Kollektsioonide uuendamine ebaõnnestus:', e);
    }
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
    refreshCollections,
    getCollectionName,
    getCollectionPath
  }), [selectedCollection, setSelectedCollection, collections, isLoading, refreshCollections, getCollectionName, getCollectionPath]);

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
