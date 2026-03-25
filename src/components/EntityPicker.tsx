import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Globe, User, MapPin, BookOpen, Tag, X, Loader2, ExternalLink, Database, Library, BookMarked, UserPlus, Users, IdCard } from 'lucide-react';
import { searchWikidata, getEntityLabels, WikidataSearchResult } from '../services/wikidataService';
import { searchViaf, ViafSearchResult } from '../services/viafService';
import { searchGnd, GndSearchResult } from '../services/gndService';
import { LinkedEntity } from '../types/LinkedEntity';
import { getLabel } from '../utils/metadataUtils';
import { getEntityUrl } from '../utils/entityUrl';
import { listPersons, createPerson } from '../prosopography/services/prosopographyService';
import type { ProsopoIndexEntry } from '../prosopography/types';

interface SuggestionItem {
  label: string;
  id: string | null;
}

// Normaliseerib "Perenimi, Eesnimi" → "Eesnimi Perenimi" (GND/VIAF formaat)
function normalizePersonName(name: string): string {
  if (!name.includes(',')) return name;
  const commaIdx = name.indexOf(',');
  const surname = name.substring(0, commaIdx).trim();
  const rest = name.substring(commaIdx + 1).trim();
  return rest ? `${rest} ${surname}` : name;
}

export interface PeopleRegisterEntry {
  primary_name: string;
  aliases: string[];
  ids: { wikidata?: string; gnd?: string; viaf?: string };
}

interface EntityPickerProps {
  label?: string;
  placeholder?: string;
  type: 'place' | 'person' | 'printer' | 'genre' | 'topic';
  value: string | LinkedEntity | undefined | null;
  onChange: (value: LinkedEntity | null) => void;
  className?: string;
  lang?: string;
  localSuggestions?: SuggestionItem[];
  peopleRegister?: PeopleRegisterEntry[];
  alreadySelected?: LinkedEntity[];
  // Prosopograafia toggle — nähtav creators/publisher/tags kontekstis
  showPersonToggle?: boolean;
  defaultPersonSearch?: boolean;
  // Token uue isiku automaatseks loomiseks (Wikidata valikul person-režiimis)
  token?: string;
}

type Suggestion = WikidataSearchResult & {
  isLocal?: boolean;
  isViaf?: boolean;
  isGnd?: boolean;
  isRegister?: boolean;
  isAlreadyAdded?: boolean;
  displayLabel?: string; // Kuvatav nimi dropdownis (võib erineda salvestatavast label-ist)
};

// Tagastab tulemuse välise lingi (Wikidata, GND, VIAF)
function getResultUrl(result: Suggestion): string | null {
  if (result.url) return result.url;
  if (result.id && !result.id.startsWith('local-') && !result.isLocal) {
    return `https://www.wikidata.org/wiki/${result.id}`;
  }
  return null;
}

const EntityPicker: React.FC<EntityPickerProps> = ({
  label,
  placeholder,
  type,
  value,
  onChange,
  className = '',
  lang = 'et',
  localSuggestions = [],
  peopleRegister = [],
  alreadySelected = [],
  showPersonToggle = false,
  defaultPersonSearch = false,
  token,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Prosopograafia režiim
  const [isPersonSearch, setIsPersonSearch] = useState(defaultPersonSearch);
  const [prosopoResults, setProsopoResults] = useState<ProsopoIndexEntry[]>([]);
  const [showExternalSearch, setShowExternalSearch] = useState(false);
  const [externalResults, setExternalResults] = useState<Suggestion[]>([]);
  const [isExternalLoading, setIsExternalLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const justSelectedRef = useRef(false);
  const localSuggestionsRef = useRef(localSuggestions);
  // Jälgib milliseid Q-koode on juba enrichitud — väldib lõputut silmust
  const enrichedIdsRef = useRef<Set<string>>(new Set());
  localSuggestionsRef.current = localSuggestions;
  const peopleRegisterRef = useRef(peopleRegister);
  peopleRegisterRef.current = peopleRegister;
  const alreadySelectedRef = useRef(alreadySelected);
  alreadySelectedRef.current = alreadySelected;
  // Race condition vältimiseks: iga otsingutsükkel saab unikaalse ID
  const searchIdRef = useRef(0);
  const prosopoSearchIdRef = useRef(0);
  const externalSearchIdRef = useRef(0);

  useEffect(() => {
    if (!value) {
      setInputValue('');
      return;
    }
    setInputValue(getLabel(value, lang));

    // Kui Q-koodiga LinkedEntity-l puudub praeguse keele label, fetch Wikidatast
    if (typeof value !== 'string' && !Array.isArray(value) && value.id && /^Q\d+$/.test(value.id)) {
      const baseLang = lang.split('-')[0];
      if (!value.labels?.[baseLang] && !enrichedIdsRef.current.has(value.id)) {
        enrichedIdsRef.current.add(value.id);
        getEntityLabels(value.id).then(multilingualLabels => {
          if (Object.keys(multilingualLabels).length > 0) {
            onChange({ ...value, labels: { ...(value.labels || {}), ...multilingualLabels } });
          }
        }).catch(() => {});
      }
    }
  }, [value, lang]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Prosopograafia otsing (person-režiimis)
  useEffect(() => {
    if (!isPersonSearch || !showSuggestions) {
      setProsopoResults([]);
      return;
    }
    const isLinkedAndUnchanged = value &&
      typeof value !== 'string' &&
      value.source !== 'manual' &&
      value.label === inputValue;
    if (!inputValue || isLinkedAndUnchanged) {
      setProsopoResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      const currentId = ++prosopoSearchIdRef.current;
      try {
        const res = await listPersons({ q: inputValue }, token);
        if (prosopoSearchIdRef.current !== currentId) return;
        setProsopoResults(res.results.slice(0, 6));
      } catch {
        if (prosopoSearchIdRef.current === currentId) setProsopoResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [inputValue, showSuggestions, isPersonSearch, value]);

  // Väline otsing (Wikidata/GND/VIAF) — person-režiimis ainult nõudmisel, muidu automaatne
  useEffect(() => {
    if (isPersonSearch && !showExternalSearch) {
      setExternalResults([]);
      return;
    }
    const isLinkedAndUnchanged = value &&
      typeof value !== 'string' &&
      value.source !== 'manual' &&
      value.label === inputValue;
    if (!inputValue || !showSuggestions || isLinkedAndUnchanged) {
      setExternalResults([]);
      setSuggestions([]);
      return;
    }

    const run = async () => {
      if (isPersonSearch) {
        // Person-režiimis: ainult Wikidata/GND/VIAF, lokaalset ei lisa
        const currentId = ++externalSearchIdRef.current;
        setIsExternalLoading(true);
        const promises: Promise<any>[] = [searchWikidata(inputValue), searchGnd(inputValue), searchViaf(inputValue)];
        const results = await Promise.allSettled(promises);
        if (externalSearchIdRef.current !== currentId) return;

        const alreadyProsopoIds = new Set(prosopoResults.map(p => p.id));
        const wdMatches: Suggestion[] = results[0].status === 'fulfilled'
          ? (results[0].value as WikidataSearchResult[]).filter(m => !alreadyProsopoIds.has(m.id))
          : [];
        const gndMatches: Suggestion[] = results[1]?.status === 'fulfilled'
          ? (results[1].value as GndSearchResult[]).map(g => ({ id: g.id, label: g.label, description: g.description, url: g.url, isGnd: true }))
          : [];
        const viafMatches: Suggestion[] = results[2]?.status === 'fulfilled'
          ? (results[2].value as ViafSearchResult[]).map(v => ({ id: v.id, label: v.label, description: v.description, url: v.url, isViaf: true }))
          : [];
        setExternalResults([...gndMatches, ...viafMatches, ...wdMatches]);
        setIsExternalLoading(false);
      } else {
        // Tavaline režiim — olemasolev loogika
        const currentSearchId = ++searchIdRef.current;
        setIsLoading(true);

        const normalizedInput = inputValue.toLowerCase();
        const localDbText = lang === 'en' ? 'Local database' : 'Kohalik andmebaas';
        const linkedText = lang === 'en' ? 'linked' : 'seotud';
        const unlinkedText = lang === 'en' ? 'unlinked' : 'sidumata';

        const alreadyAddedMatches: Suggestion[] = alreadySelectedRef.current
          .filter(s => {
            if (s.label.toLowerCase().includes(normalizedInput)) return true;
            if (s.labels && typeof s.labels === 'object') {
              return Object.values(s.labels).some(
                l => typeof l === 'string' && l.toLowerCase().includes(normalizedInput)
              );
            }
            return false;
          })
          .map(s => ({
            id: s.id || ('local-' + s.label),
            label: s.label,
            description: lang === 'en' ? 'Already added' : 'Juba lisatud',
            url: '',
            isLocal: true,
            isAlreadyAdded: true
          }));

        const alreadyAddedIds = new Set(alreadyAddedMatches.filter(m => m.id && !m.id.startsWith('local-')).map(m => m.id));

        const localMatches: Suggestion[] = localSuggestionsRef.current
          .filter(s => s.label.toLowerCase().includes(normalizedInput))
          .filter(s => !alreadyAddedIds.has(s.id || ''))
          .sort((a, b) => {
            const aStarts = a.label.toLowerCase().startsWith(normalizedInput) ? 0 : 1;
            const bStarts = b.label.toLowerCase().startsWith(normalizedInput) ? 0 : 1;
            return aStarts - bStarts;
          })
          .slice(0, 3)
          .map(s => ({
            id: s.id || ('local-' + s.label),
            label: s.label,
            description: s.id ? `${localDbText} (${linkedText}: ${s.id})` : `${localDbText} (${unlinkedText})`,
            url: '',
            isLocal: true
          }));

        const localIds = new Set(localMatches.filter(m => !m.id.startsWith('local-')).map(m => m.id));

        let registerMatches: Suggestion[] = [];
        if ((type === 'person' || type === 'printer') && peopleRegisterRef.current.length > 0) {
          const registerText = lang === 'en' ? 'People register' : 'Isikute register';
          const seenRegisterIds = new Set<string>();

          for (const person of peopleRegisterRef.current) {
            const nameMatch = person.primary_name.toLowerCase().includes(normalizedInput);
            const matchingAlias = person.aliases.find(a => a.toLowerCase().includes(normalizedInput));

            if (nameMatch || matchingAlias) {
              const bestId = person.ids.wikidata ? `Q${person.ids.wikidata.replace(/^Q/, '')}` :
                             person.ids.gnd ? `GND:${person.ids.gnd}` :
                             person.ids.viaf ? `VIAF:${person.ids.viaf}` : null;
              const dedupeKey = bestId ?? `local-${person.primary_name}`;
              if (seenRegisterIds.has(dedupeKey)) continue;
              seenRegisterIds.add(dedupeKey);
              if (bestId && localIds.has(bestId)) continue;

              const primaryLabel = normalizePersonName(person.primary_name);
              const displayLabel = matchingAlias && !nameMatch
                ? `${matchingAlias} → ${primaryLabel}`
                : undefined;

              registerMatches.push({
                id: bestId ?? `local-${person.primary_name}`,
                label: primaryLabel,
                displayLabel,
                description: registerText,
                url: '',
                isLocal: true,
                isRegister: true
              });
            }
          }
          registerMatches = registerMatches.slice(0, 3);
        }

        const allLocalIds = new Set([...alreadyAddedIds, ...localIds, ...registerMatches.map(m => m.id)]);

        const externalPromises: Promise<any>[] = [searchWikidata(inputValue)];
        if (type === 'person' || type === 'printer') {
          externalPromises.push(searchGnd(inputValue));
          externalPromises.push(searchViaf(inputValue));
        }

        const results = await Promise.allSettled(externalPromises);
        if (searchIdRef.current !== currentSearchId) return;

        const wikidataMatches: Suggestion[] = results[0].status === 'fulfilled'
          ? (results[0].value as WikidataSearchResult[]).filter(m => !allLocalIds.has(m.id))
          : [];

        let gndMatches: Suggestion[] = [];
        let viafMatches: Suggestion[] = [];

        if (type === 'person' || type === 'printer') {
          gndMatches = results[1]?.status === 'fulfilled'
            ? (results[1].value as GndSearchResult[])
                .filter(m => !allLocalIds.has(m.id))
                .map(g => ({ id: g.id, label: g.label, description: g.description, url: g.url, isGnd: true }))
            : [];

          viafMatches = results[2]?.status === 'fulfilled'
            ? (results[2].value as ViafSearchResult[])
                .filter(m => !allLocalIds.has(m.id))
                .map(v => ({ id: v.id, label: v.label, description: v.description, url: v.url, isViaf: true }))
            : [];
        }

        setSuggestions([...alreadyAddedMatches, ...localMatches, ...registerMatches, ...gndMatches, ...viafMatches, ...wikidataMatches]);
        setIsLoading(false);
        setSelectedIndex(0);
      }
    };

    const timer = setTimeout(run, 300);
    return () => clearTimeout(timer);
  }, [inputValue, showSuggestions, isPersonSearch, showExternalSearch, value]);

  // Prosopograafia kirje valimisel
  const handleSelectProsopo = (entry: ProsopoIndexEntry) => {
    justSelectedRef.current = true;
    const entity: LinkedEntity = {
      id: entry.id,
      label: entry.label,
      source: 'local',
      entity_type: 'person',
      labels: { et: entry.label },
    };
    onChange(entity);
    setInputValue(entry.label);
    setShowSuggestions(false);
  };

  const handleSelect = async (result: Suggestion) => {
    justSelectedRef.current = true;
    setIsLoading(true);

    let entity: LinkedEntity;

    if (result.id.startsWith('local-')) {
      entity = { id: null, label: result.label, source: 'manual', labels: { et: result.label } };
    } else if (result.isGnd || result.id.startsWith('GND:')) {
      const label = normalizePersonName(result.label);
      if (isPersonSearch && token) {
        // Person-režiimis: loo prosopograafia kirje GND identifikaatoriga
        try {
          const gndId = result.id.replace(/^GND:/i, '');
          const record = await createPerson({ name: label, identifiers: [{ scheme: 'gnd', id: gndId }] } as any, token);
          entity = { id: record.id, label: record.name.label, source: 'local', entity_type: 'person', labels: { et: record.name.label } };
        } catch {
          entity = { id: result.id, label, source: 'gnd', labels: { et: label } };
        }
      } else {
        entity = { id: result.id, label, source: 'gnd', labels: { et: label } };
      }
    } else if (result.isViaf || result.id.startsWith('VIAF:')) {
      const label = normalizePersonName(result.label);
      if (isPersonSearch && token) {
        try {
          const viafId = result.id.replace(/^VIAF:/i, '');
          const record = await createPerson({ name: label, identifiers: [{ scheme: 'viaf', id: viafId }] } as any, token);
          entity = { id: record.id, label: record.name.label, source: 'local', entity_type: 'person', labels: { et: record.name.label } };
        } catch {
          entity = { id: result.id, label, source: 'viaf', labels: { et: label } };
        }
      } else {
        entity = { id: result.id, label, source: 'viaf', labels: { et: label } };
      }
    } else if (result.isLocal && !/^Q\d+$/.test(result.id)) {
      entity = { id: result.id.startsWith('local-') ? null : result.id, label: result.label, source: 'manual', labels: { et: result.label } };
    } else {
      // Wikidata Q-kood — fetch kõik keeled
      let multilingualLabels: Record<string, string> = { et: result.label };
      try {
        multilingualLabels = await getEntityLabels(result.id);
      } catch (e) {
        console.warn("Ei saanud silte Wikidatast", e);
      }
      const baseLang = lang.split('-')[0];
      const bestLabel = multilingualLabels[baseLang] || multilingualLabels.en || result.label;

      if (isPersonSearch && token) {
        // Person-režiimis: loo prosopograafia kirje Wikidata identifikaatoriga
        try {
          const record = await createPerson({ name: bestLabel, identifiers: [{ scheme: 'wikidata', id: result.id }] } as any, token);
          entity = { id: record.id, label: record.name.label, source: 'local', entity_type: 'person', labels: multilingualLabels };
        } catch {
          entity = { id: result.id, label: bestLabel, source: 'wikidata', labels: multilingualLabels };
        }
      } else {
        entity = { id: result.id, label: bestLabel, source: 'wikidata', labels: multilingualLabels };
      }
    }

    onChange(entity);
    setInputValue(value === null ? '' : entity.label);
    setShowSuggestions(false);
    setIsLoading(false);
  };

  const handleManualEntry = () => {
    if (!inputValue.trim()) { onChange(null); return; }
    const existingId = value && typeof value !== 'string' ? value.id : null;
    const existingSource = value && typeof value !== 'string' ? value.source : null;
    const existingLabels = value && typeof value !== 'string' ? (value.labels || {}) : {};
    const baseLang = lang.split('-')[0];
    onChange({
      id: existingId,
      label: inputValue.trim(),
      source: existingId ? (existingSource || 'manual') : 'manual',
      labels: { ...existingLabels, [baseLang]: inputValue.trim() }
    });
    if (value === null) setInputValue('');
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (isPersonSearch) {
        setSelectedIndex(prev => Math.min(prev + 1, prosopoResults.length + externalResults.length));
      } else {
        setSelectedIndex(prev => Math.min(prev + 1, suggestions.length));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isPersonSearch) {
        if (selectedIndex < prosopoResults.length) handleSelectProsopo(prosopoResults[selectedIndex]);
        else if (selectedIndex < prosopoResults.length + externalResults.length) handleSelect(externalResults[selectedIndex - prosopoResults.length]);
        else handleManualEntry();
      } else {
        if (selectedIndex < suggestions.length) handleSelect(suggestions[selectedIndex]);
        else handleManualEntry();
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'place': return <MapPin size={16} />;
      case 'person': return <User size={16} />;
      case 'genre': return <BookOpen size={16} />;
      case 'printer': return <Globe size={16} />;
      default: return <Tag size={16} />;
    }
  };

  const isLinked = value && typeof value !== 'string' && value.source !== 'manual';
  const entityId = value && typeof value !== 'string' ? value.id : null;
  const entitySource = value && typeof value !== 'string' ? value.source : undefined;
  const entityUrl = entityId?.startsWith('vutt:P') ? null : getEntityUrl(entityId, entitySource);

  const togglePersonSearch = () => {
    setIsPersonSearch(p => !p);
    setShowExternalSearch(false);
    setProsopoResults([]);
    setExternalResults([]);
    setSelectedIndex(0);
  };

  const hasResults = isPersonSearch
    ? (prosopoResults.length > 0 || externalResults.length > 0)
    : suggestions.length > 0;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {label && (
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 px-1">
          {label}
        </label>
      )}

      <div className="relative">
        <div className={`absolute left-3 top-1/2 -translate-y-1/2 ${isLinked ? 'text-green-500' : 'text-gray-400'}`}>
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : getIcon()}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setShowSuggestions(true); setShowExternalSearch(false); }}
          onFocus={() => { justSelectedRef.current = false; setShowSuggestions(true); }}
          onBlur={() => {
            if (justSelectedRef.current) { justSelectedRef.current = false; return; }
            const currentLabel = value ? (typeof value === 'string' ? value : value.label) : '';
            if (inputValue.trim() !== currentLabel) handleManualEntry();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || `Otsi ${label?.toLowerCase() || 'väärtust'}...`}
          className={`w-full pl-10 ${entityUrl ? 'pr-16' : 'pr-10'} py-2 text-sm border rounded-md outline-none transition-all ${
            isLinked
              ? 'border-green-200 bg-green-50/30 focus:border-green-400 focus:ring-2 focus:ring-green-100'
              : 'border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-100'
          }`}
        />

        {entityId?.startsWith('vutt:P') ? (
          <Link
            to={`/persons/${entityId}`}
            className="absolute right-9 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary-600 p-0.5 rounded-full hover:bg-primary-50 transition-colors"
            title="Vaata isiku profiili"
            onClick={(e) => e.stopPropagation()}
          >
            <IdCard size={14} />
          </Link>
        ) : entityUrl ? (
          <a
            href={entityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute right-9 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 p-0.5 rounded-full hover:bg-blue-50 transition-colors"
            title="Vaata andmebaasis"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={14} />
          </a>
        ) : null}

        {inputValue && (
          <button
            onClick={() => { setInputValue(''); onChange(null); inputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full hover:bg-gray-100"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showSuggestions && (inputValue.length >= 2 || hasResults) && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden max-h-80 flex flex-col">

          {/* Person-toggle */}
          {showPersonToggle && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100"
              onMouseDown={(e) => { e.preventDefault(); justSelectedRef.current = true; }}
            >
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isPersonSearch}
                  onChange={togglePersonSearch}
                  className="w-3 h-3 rounded accent-blue-600"
                />
                <User size={11} className={isPersonSearch ? 'text-blue-600' : 'text-gray-400'} />
                <span className={`text-[11px] font-medium ${isPersonSearch ? 'text-blue-700' : 'text-gray-500'}`}>
                  {lang === 'en' ? 'Person' : 'Isik'}
                </span>
              </label>
              {isPersonSearch && (
                <span className="text-[10px] text-blue-500 italic">
                  {lang === 'en' ? 'searching persons register' : 'otsib isikute registrist'}
                </span>
              )}
            </div>
          )}

          <div className="overflow-y-auto flex-1">
            {isPersonSearch ? (
              <>
                {/* Prosopograafia tulemused */}
                {prosopoResults.map((entry, idx) => (
                  <div
                    key={entry.id}
                    className={`w-full px-3 py-2 border-b border-gray-50 flex items-start gap-2 cursor-pointer ${
                      idx === selectedIndex ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' : 'bg-indigo-50/40 hover:bg-indigo-100/40'
                    }`}
                    onMouseDown={() => { justSelectedRef.current = true; }}
                    onClick={() => handleSelectProsopo(entry)}
                  >
                    <User size={12} className="mt-0.5 shrink-0 text-indigo-500" />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 text-sm block truncate">{entry.label}</span>
                      <span className="text-[10px] text-indigo-500/80 italic flex items-center gap-1.5">
                        <span>{entry.id}</span>
                        {entry.birth_year && <span>*{entry.birth_year}</span>}
                        {entry.death_year && <span>†{entry.death_year}</span>}
                        {entry.has_wikidata && <span className="text-blue-400">WD</span>}
                        {entry.has_gnd && <span className="text-orange-400">GND</span>}
                      </span>
                    </span>
                  </div>
                ))}

                {/* Wikidata sekundaarne otsing */}
                {!showExternalSearch ? (
                  <button
                    onMouseDown={() => { justSelectedRef.current = true; }}
                    onClick={() => setShowExternalSearch(true)}
                    className="w-full px-4 py-2.5 text-left flex items-center gap-2 text-gray-500 hover:bg-gray-50 border-b border-gray-100 text-xs"
                  >
                    <Globe size={12} className="text-blue-400 shrink-0" />
                    <span>{lang === 'en' ? 'Search Wikidata / GND / VIAF...' : 'Otsi Wikidatast / GND / VIAF...'}</span>
                  </button>
                ) : (
                  <>
                    {isExternalLoading && (
                      <div className="px-4 py-2 flex items-center gap-2 text-xs text-gray-400">
                        <Loader2 size={11} className="animate-spin" />
                        {lang === 'en' ? 'Searching...' : 'Otsib...'}
                      </div>
                    )}
                    {externalResults.map((result, idx) => {
                      const isGnd = result.isGnd || result.id.startsWith('GND:');
                      const isViaf = result.isViaf || result.id.startsWith('VIAF:');
                      const rowUrl = getResultUrl(result);
                      const absIdx = prosopoResults.length + idx;
                      return (
                        <div
                          key={result.id}
                          className={`w-full px-3 py-2 border-b border-gray-50 flex items-start gap-2 group cursor-pointer ${
                            absIdx === selectedIndex ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' : 'hover:bg-gray-50'
                          }`}
                          onMouseDown={() => { justSelectedRef.current = true; }}
                          onClick={() => handleSelect(result)}
                        >
                          <span className="mt-0.5 shrink-0">
                            {isGnd && <BookMarked size={12} className="text-orange-600" />}
                            {isViaf && <Library size={12} className="text-purple-600" />}
                            {!isGnd && !isViaf && <Globe size={12} className="text-blue-400" />}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="font-medium text-gray-900 text-sm block truncate">{result.label}</span>
                            {result.description && (
                              <span className={`text-xs block truncate ${isGnd ? 'text-orange-500/80' : isViaf ? 'text-purple-500/80' : 'text-gray-500'}`}>
                                {result.description}
                              </span>
                            )}
                          </span>
                          {rowUrl && (
                            <a href={rowUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1}
                              onClick={e => e.stopPropagation()}
                              onMouseDown={e => { justSelectedRef.current = true; e.preventDefault(); e.stopPropagation(); }}
                              className="shrink-0 mt-0.5 p-1 rounded text-gray-300 hover:text-blue-600 hover:bg-blue-50 transition-colors opacity-0 group-hover:opacity-100">
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {/* Loo uus isik */}
                <Link
                  to={inputValue.trim() ? `/persons/new?name=${encodeURIComponent(inputValue.trim())}` : '/persons/new'}
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseDown={() => { justSelectedRef.current = true; }}
                  className="w-full px-4 py-2.5 flex items-center gap-2 text-gray-500 hover:bg-green-50 hover:text-green-700 text-xs transition-colors border-b border-gray-100"
                >
                  <UserPlus size={12} className="text-green-500 shrink-0" />
                  <span>{lang === 'en' ? 'Create new person ↗' : 'Loo uus isik ↗'}</span>
                </Link>

                {/* Käsitsi sisestus */}
                <button
                  onMouseDown={() => { justSelectedRef.current = true; }}
                  onClick={handleManualEntry}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-2 text-gray-600 italic ${
                    selectedIndex === prosopoResults.length + externalResults.length ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' : ''
                  }`}
                >
                  <Tag size={14} className="opacity-50" />
                  <span className="text-xs">
                    {lang === 'en' ? `Use manual entry: "${inputValue}"` : `Kasuta käsitsi sisestust: "${inputValue}"`}
                  </span>
                </button>
              </>
            ) : (
              <>
                {/* Tavaline režiim */}
                {suggestions.map((result, idx) => {
                  const isLocal = result.isLocal;
                  const isRegister = result.isRegister;
                  const isGnd = result.isGnd || result.id.startsWith('GND:');
                  const isViaf = result.isViaf || result.id.startsWith('VIAF:');
                  const rowUrl = getResultUrl(result);
                  const isAlreadyAdded = result.isAlreadyAdded;

                  return (
                    <div
                      key={result.id}
                      className={`w-full px-3 py-2 border-b border-gray-50 flex items-start gap-2 group cursor-pointer ${
                        idx === selectedIndex ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' :
                        isAlreadyAdded ? 'bg-blue-50/60 hover:bg-blue-100/60' :
                        isRegister ? 'bg-teal-50/60 hover:bg-teal-100/60' :
                        isLocal ? 'bg-amber-50/60 hover:bg-amber-100/60' :
                        'hover:bg-gray-50'
                      }`}
                      onMouseDown={() => { justSelectedRef.current = true; }}
                      onClick={() => handleSelect(result)}
                    >
                      <span className="mt-0.5 shrink-0">
                        {isAlreadyAdded && <Tag size={12} className="text-blue-500" />}
                        {!isAlreadyAdded && isRegister && <Users size={12} className="text-teal-600" />}
                        {!isAlreadyAdded && isLocal && !isRegister && <Database size={12} className="text-amber-600" />}
                        {isGnd && <BookMarked size={12} className="text-orange-600" />}
                        {isViaf && <Library size={12} className="text-purple-600" />}
                        {!isLocal && !isGnd && !isViaf && <Globe size={12} className="text-blue-400" />}
                      </span>

                      <span className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 text-sm block truncate">{result.displayLabel || result.label}</span>
                        {result.description && (
                          <span className={`text-xs block truncate ${
                            isAlreadyAdded ? 'text-blue-600/80 italic' :
                            isRegister ? 'text-teal-600/80 italic' :
                            isLocal ? 'text-amber-600/80 italic' :
                            isGnd ? 'text-orange-500/80' :
                            isViaf ? 'text-purple-500/80' :
                            'text-gray-500'
                          }`}>{result.description}</span>
                        )}
                      </span>

                      {rowUrl && (
                        <a
                          href={rowUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          tabIndex={-1}
                          title={lang === 'en' ? 'View in database' : 'Vaata andmebaasis'}
                          onClick={e => e.stopPropagation()}
                          onMouseDown={e => { justSelectedRef.current = true; e.preventDefault(); e.stopPropagation(); }}
                          className="shrink-0 mt-0.5 p-1 rounded text-gray-300 hover:text-blue-600 hover:bg-blue-50 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  );
                })}

                {/* Käsitsi sisestus */}
                <button
                  onMouseDown={() => { justSelectedRef.current = true; }}
                  onClick={handleManualEntry}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-2 text-gray-600 italic ${
                    selectedIndex === suggestions.length ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' : ''
                  }`}
                >
                  <Tag size={14} className="opacity-50" />
                  <span className="text-xs">
                    {value && typeof value !== 'string' && value.id
                      ? (lang === 'en' ? `Update name to "${inputValue}" (keep ${value.id})` : `Muuda nimeks "${inputValue}" (säilita ${value.id})`)
                      : (lang === 'en' ? `Use manual entry: "${inputValue}"` : `Kasuta käsitsi sisestust: "${inputValue}"`)}
                  </span>
                </button>
              </>
            )}
          </div>

          <div className="bg-gray-50 px-3 py-1.5 border-t border-gray-100 flex justify-between items-center shrink-0">
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider flex items-center gap-2">
              {isPersonSearch ? (
                <>
                  <span className="flex items-center gap-1"><User size={10} className="text-indigo-400" /> Prosopograafia</span>
                  {showExternalSearch && <>
                    <span className="flex items-center gap-1"><Globe size={10} /> Wikidata</span>
                    <span className="flex items-center gap-1"><BookMarked size={10} className="text-orange-500" /> GND</span>
                    <span className="flex items-center gap-1"><Library size={10} className="text-purple-500" /> VIAF</span>
                  </>}
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1"><Globe size={10} /> Wikidata</span>
                  {(type === 'person' || type === 'printer') && <>
                    <span className="flex items-center gap-1"><BookMarked size={10} className="text-orange-500" /> GND</span>
                    <span className="flex items-center gap-1"><Library size={10} className="text-purple-500" /> VIAF</span>
                  </>}
                </>
              )}
            </span>
            {(isLoading || isExternalLoading) && <Loader2 size={10} className="animate-spin text-gray-400" />}
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityPicker;
