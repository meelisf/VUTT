import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { getCollections, Collections } from '../services/collectionService';
import { listWorkSetsSafe, invalidateWorkSetIds, WorkSetSummary } from '../services/workSetService';
import { useUser } from './UserContext';
import { CollectionSelection } from '../services/selectionFilter';
import {
  decideStoredCollection,
  parseSelection,
  readSelectionToken,
  resolveInitialCollection,
  serializeSelection,
} from './collectionUrl';

interface CollectionContextType {
  /**
   * Aktiivne valik: kõik teosed, püsikogu või töökollektsioon (#354).
   * See on ainus tõene allikas; `selectedCollection` on temast tuletatud.
   */
  selection: CollectionSelection;
  setSelection: (selection: CollectionSelection) => void;

  /**
   * Valitud PÜSIKOGU ID (null = kõik tööd VÕI aktiivne töökollektsioon).
   * Tagasiühilduv vaade `selection`-ile: kutsujad, kes töökollektsiooni ei
   * tunne, käituvad tema ajal nagu „kõik teosed". Uus kood kasutagu
   * `selection`-it — muidu näeb ta valikust mööda.
   */
  selectedCollection: string | null;
  setSelectedCollection: (id: string | null) => void;

  // Kutsujale nähtavad töökollektsioonid (aktiivsed)
  workSets: WorkSetSummary[];
  /** Loendi laadimise viga. `[]` + `null` = kogusid ei ole; `[]` + viga = ei saanud teada. */
  workSetsError: Error | null;
  refreshWorkSets: () => Promise<void>;

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
  const [selection, setSelectionState] = useState<CollectionSelection>({ kind: 'all' });
  const [collections, setCollections] = useState<Collections>({});
  const [workSets, setWorkSets] = useState<WorkSetSummary[]>([]);
  const [workSetsError, setWorkSetsError] = useState<Error | null>(null);
  const { authToken, isLoading: authLoading } = useUser();
  const [isLoading, setIsLoading] = useState(true);
  const selectedCollection = selection.kind === 'collection' ? selection.id : null;

  // Lae kollektsioonid ja taasta valik localStorage'ist
  useEffect(() => {
    const init = async () => {
      try {
        // Kogud ja töökollektsioonid korraga: valiku lahendamine vajab MÕLEMAT.
        // Töökollektsioonide loendi ebaõnnestumine (nt anonüümne kasutaja) ei
        // tohi kogusid maha võtta — sellest saab tühi loend, mitte viga.
        const [data, wsRes] = await Promise.all([getCollections(), listWorkSetsSafe()]);
        const sets = wsRes.sets;
        setCollections(data);
        setWorkSets(sets);
        setWorkSetsError(wsRes.error);

        // URL > localStorage > vaikekogu (#323). URL loetakse `window.location`-ist,
        // mitte `useSearchParams`-ist: provider istub Routerist väljaspool ja see
        // on ühekordne algväärtus, mitte jooksev sünkroniseerimine.
        const stored = localStorage.getItem(STORAGE_KEY);
        const params = new URLSearchParams(window.location.search);
        const token = readSelectionToken(params) ?? stored;
        const kandidaat = parseSelection(token);

        // Töökollektsioon kehtib ainult siis, kui ta on kutsujale NÄHTAV.
        // Kadunud ligipääsuga kogu ei tohi jätta vaadet vaikselt tühjaks —
        // siis kehtib tavaline kogu-lahendus.
        if (kandidaat.kind === 'work_set' && sets.some(ws => ws.id === kandidaat.id)) {
          setSelectionState(kandidaat);
          localStorage.setItem(STORAGE_KEY, serializeSelection(kandidaat));
          return;
        }

        // Töökollektsiooni token ei ole kogu-id: kogu-lahendus ei tohi teda näha.
        const fromUrl = kandidaat.kind === 'collection'
          && readSelectionToken(params) !== null ? kandidaat.id : null;
        const storedCollection = stored && !stored.startsWith('s:') ? stored : null;
        const initial = resolveInitialCollection(fromUrl, storedCollection, data, DEFAULT_COLLECTION);
        setSelectionState(initial ? { kind: 'collection', id: initial } : { kind: 'all' });
        // Salvestatud kirje peab lahendust PEEGELDAMA: lingiga tulnud valik
        // jääb kehtima ja kustutatud kogu jäänuk parandatakse ära. Ilma
        // parandamiseta kordub vale vaade igal laadimisel.
        const update = decideStoredCollection(fromUrl, storedCollection, data, initial);
        if (update.action === 'write') localStorage.setItem(STORAGE_KEY, update.value);
        else if (update.action === 'clear') localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        console.error('Failed to load collections:', e);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  const refreshWorkSets = useCallback(async () => {
    const { sets, error } = await listWorkSetsSafe();
    setWorkSets(sets);
    setWorkSetsError(error);
    if (error) console.error('Töökollektsioonide uuendamine ebaõnnestus:', error);
  }, []);

  /**
   * Kogude loend SÕLTUB kutsujast, seega peab autentimisoleku muutus ta uuesti
   * laadima. Ilma selleta jäi sisselogimise-eelne (tihti tühi või anonüümne)
   * loend igavesti kehtima: deploy tappis sessioonid, mount'i päring sai 401 ja
   * pärast uut sisselogimist ei laetud enam kunagi — „Lisa töökollektsiooni"
   * nupp oli kadunud ilma ühegi veateateta.
   *
   * Esimene laadimine elab init-effectis; siin ainult MUUTUSED, et mount'il ei
   * tehtaks kahte päringut.
   */
  const eelmineToken = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (authLoading) return;
    if (eelmineToken.current === undefined) { eelmineToken.current = authToken; return; }
    if (eelmineToken.current === authToken) return;
    eelmineToken.current = authToken;
    // Vana kasutaja ID-loendid EI TOHI uuele kasutajale jääda.
    invalidateWorkSetIds();
    refreshWorkSets();
  }, [authToken, authLoading, refreshWorkSets]);

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
  const setSelection = useCallback((next: CollectionSelection) => {
    setSelectionState(next);
    if (next.kind === 'all') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, serializeSelection(next));
    }
  }, []);

  /** Tagasiühilduv sisend: kogu-id või null (= kõik teosed). */
  const setSelectedCollection = useCallback((id: string | null) => {
    setSelection(id ? { kind: 'collection', id } : { kind: 'all' });
  }, [setSelection]);

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
    selection,
    setSelection,
    selectedCollection,
    setSelectedCollection,
    collections,
    workSets,
    workSetsError,
    refreshWorkSets,
    isLoading,
    refreshCollections,
    getCollectionName,
    getCollectionPath
  }), [selection, setSelection, selectedCollection, setSelectedCollection, collections,
       workSets, workSetsError, refreshWorkSets, isLoading, refreshCollections,
       getCollectionName, getCollectionPath]);

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
