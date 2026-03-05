import React, { useState, useEffect, useRef } from 'react';
import { Search, Globe, User, Users, MapPin, BookOpen, Tag, X, Loader2, ExternalLink, Database, Library, BookMarked } from 'lucide-react';
import { searchWikidata, getEntityLabels, WikidataSearchResult } from '../services/wikidataService';
import { searchViaf, ViafSearchResult } from '../services/viafService';
import { searchGnd, GndSearchResult } from '../services/gndService';
import { LinkedEntity } from '../types/LinkedEntity';
import { getLabel } from '../utils/metadataUtils';
import { getEntityUrl } from '../utils/entityUrl';

interface SuggestionItem {
  label: string;
  id: string | null;
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
}

type Suggestion = WikidataSearchResult & {
  isLocal?: boolean;
  isViaf?: boolean;
  isGnd?: boolean;
  isRegister?: boolean;
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
  peopleRegister = []
}) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const justSelectedRef = useRef(false);
  const localSuggestionsRef = useRef(localSuggestions);
  // Jälgib milliseid Q-koode on juba enrichitud — väldib lõputut silmust
  const enrichedIdsRef = useRef<Set<string>>(new Set());
  localSuggestionsRef.current = localSuggestions;
  const peopleRegisterRef = useRef(peopleRegister);
  peopleRegisterRef.current = peopleRegister;
  // Race condition vältimiseks: iga otsingutsükkel saab unikaalse ID
  const searchIdRef = useRef(0);

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

  // Debounced search — paralleelsed päringud + race condition kaitse
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!inputValue || !showSuggestions || (value && (typeof value === 'string' ? value : value.label) === inputValue)) {
        setSuggestions([]);
        return;
      }

      const currentSearchId = ++searchIdRef.current;
      setIsLoading(true);

      const normalizedInput = inputValue.toLowerCase();
      const localDbText = lang === 'en' ? 'Local database' : 'Kohalik andmebaas';
      const linkedText = lang === 'en' ? 'linked' : 'seotud';
      const unlinkedText = lang === 'en' ? 'unlinked' : 'sidumata';

      // 1. Kohalikud soovitused — sõnaalguse match esikohal, piiratud 3-le
      const localMatches: Suggestion[] = localSuggestionsRef.current
        .filter(s => s.label.toLowerCase().includes(normalizedInput))
        .sort((a, b) => {
          // Sõnaalgusega match enne kui lihtsalt sisaldab
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

      // 2. Isikute register
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
            if (!bestId || seenRegisterIds.has(bestId)) continue;
            seenRegisterIds.add(bestId);
            if (localIds.has(bestId)) continue;

            const desc = matchingAlias && !nameMatch
              ? `${registerText} (alias: ${matchingAlias})`
              : registerText;

            registerMatches.push({
              id: bestId,
              label: person.primary_name,
              description: desc,
              url: '',
              isLocal: true,
              isRegister: true
            });
          }
        }
        registerMatches = registerMatches.slice(0, 3);
      }

      const allLocalIds = new Set([...localIds, ...registerMatches.map(m => m.id)]);

      // 3. Välised päringud paralleelselt
      const externalPromises: Promise<any>[] = [searchWikidata(inputValue)];
      if (type === 'person' || type === 'printer') {
        externalPromises.push(searchGnd(inputValue));
        externalPromises.push(searchViaf(inputValue));
      }

      const results = await Promise.allSettled(externalPromises);

      // Kontrolli race condition — kas see otsing on ikka aktuaalne
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

      setSuggestions([...localMatches, ...registerMatches, ...gndMatches, ...viafMatches, ...wikidataMatches]);
      setIsLoading(false);
      setSelectedIndex(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue, showSuggestions, value]);

  const handleSelect = async (result: Suggestion) => {
    justSelectedRef.current = true;
    setIsLoading(true);

    let entity: LinkedEntity;

    if (result.id.startsWith('local-')) {
      entity = { id: null, label: result.label, source: 'manual', labels: { et: result.label } };
    } else if (result.isGnd || result.id.startsWith('GND:')) {
      entity = { id: result.id, label: result.label, source: 'gnd', labels: { et: result.label } };
    } else if (result.isViaf || result.id.startsWith('VIAF:')) {
      entity = { id: result.id, label: result.label, source: 'viaf', labels: { et: result.label } };
    } else if (result.isLocal && !/^Q\d+$/.test(result.id)) {
      // Lokaalne kirje ilma Wikidata Q-koodita — manuaalne, ainult eesti label
      entity = { id: result.id.startsWith('local-') ? null : result.id, label: result.label, source: 'manual', labels: { et: result.label } };
    } else {
      // Wikidata Q-kood (kas otse Wikidatast või kohalikust andmebaasist) — fetch kõik keeled
      let multilingualLabels: Record<string, string> = { et: result.label };
      try {
        multilingualLabels = await getEntityLabels(result.id);
      } catch (e) {
        console.warn("Ei saanud silte Wikidatast", e);
      }
      entity = { id: result.id, label: result.label, source: 'wikidata', labels: multilingualLabels };
    }

    onChange(entity);
    setInputValue(value === null ? '' : result.label);
    setShowSuggestions(false);
    setIsLoading(false);
  };

  const handleManualEntry = () => {
    if (!inputValue.trim()) { onChange(null); return; }
    const existingId = value && typeof value !== 'string' ? value.id : null;
    const existingSource = value && typeof value !== 'string' ? value.source : null;
    onChange({
      id: existingId,
      label: inputValue.trim(),
      source: existingId ? (existingSource || 'manual') : 'manual',
      labels: { et: inputValue.trim() }
    });
    if (value === null) setInputValue('');
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex < suggestions.length) handleSelect(suggestions[selectedIndex]);
      else handleManualEntry();
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
  const entityUrl = getEntityUrl(entityId, entitySource);

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
          onChange={(e) => { setInputValue(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
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

        {entityUrl && (
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
        )}

        {inputValue && (
          <button
            onClick={() => { setInputValue(''); onChange(null); inputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full hover:bg-gray-100"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showSuggestions && (inputValue.length >= 2 || suggestions.length > 0) && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden max-h-80 flex flex-col">
          <div className="overflow-y-auto flex-1">
            {suggestions.map((result, idx) => {
              const isLocal = result.isLocal;
              const isRegister = result.isRegister;
              const isGnd = result.isGnd || result.id.startsWith('GND:');
              const isViaf = result.isViaf || result.id.startsWith('VIAF:');
              const rowUrl = getResultUrl(result);

              return (
                <div
                  key={result.id}
                  className={`w-full px-3 py-2 border-b border-gray-50 flex items-start gap-2 group cursor-pointer ${
                    idx === selectedIndex ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' :
                    isRegister ? 'bg-teal-50/60 hover:bg-teal-100/60' :
                    isLocal ? 'bg-amber-50/60 hover:bg-amber-100/60' :
                    'hover:bg-gray-50'
                  }`}
                  onMouseDown={() => { justSelectedRef.current = true; }}
                  onClick={() => handleSelect(result)}
                >
                  {/* Allika ikoon */}
                  <span className="mt-0.5 shrink-0">
                    {isRegister && <Users size={12} className="text-teal-600" />}
                    {isLocal && !isRegister && <Database size={12} className="text-amber-600" />}
                    {isGnd && <BookMarked size={12} className="text-orange-600" />}
                    {isViaf && <Library size={12} className="text-purple-600" />}
                    {!isLocal && !isGnd && !isViaf && <Globe size={12} className="text-blue-400" />}
                  </span>

                  {/* Nimi + kirjeldus */}
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-gray-900 text-sm block truncate">{result.label}</span>
                    {result.description && (
                      <span className={`text-xs block truncate ${
                        isRegister ? 'text-teal-600/80 italic' :
                        isLocal ? 'text-amber-600/80 italic' :
                        isGnd ? 'text-orange-500/80' :
                        isViaf ? 'text-purple-500/80' :
                        'text-gray-500'
                      }`}>{result.description}</span>
                    )}
                  </span>

                  {/* Väline link */}
                  {rowUrl && (
                    <a
                      href={rowUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={lang === 'en' ? 'View in database' : 'Vaata andmebaasis'}
                      onClick={e => e.stopPropagation()}
                      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
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
          </div>

          <div className="bg-gray-50 px-3 py-1.5 border-t border-gray-100 flex justify-between items-center shrink-0">
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider flex items-center gap-2">
              <span className="flex items-center gap-1"><Globe size={10} /> Wikidata</span>
              {(type === 'person' || type === 'printer') && <>
                <span className="flex items-center gap-1"><BookMarked size={10} className="text-orange-500" /> GND</span>
                <span className="flex items-center gap-1"><Library size={10} className="text-purple-500" /> VIAF</span>
              </>}
            </span>
            {isLoading && <Loader2 size={10} className="animate-spin text-gray-400" />}
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityPicker;
