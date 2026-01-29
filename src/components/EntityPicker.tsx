import React, { useState, useEffect, useRef } from 'react';
import { Search, Globe, User, MapPin, BookOpen, Tag, X, Loader2, ExternalLink, Database, Library } from 'lucide-react';
import { searchWikidata, getEntityLabels, WikidataSearchResult } from '../services/wikidataService';
import { searchViaf, ViafSearchResult } from '../services/viafService';
import { LinkedEntity } from '../types/LinkedEntity';
import { getLabel } from '../utils/metadataUtils';
import { getEntityUrl } from '../utils/entityUrl';

interface SuggestionItem {
  label: string;
  id: string | null;
}

interface EntityPickerProps {
  label?: string;
  placeholder?: string;
  type: 'place' | 'person' | 'printer' | 'genre' | 'topic';
  value: string | LinkedEntity | undefined | null;
  onChange: (value: LinkedEntity | null) => void;
  className?: string;
  lang?: string; // Current UI language
  localSuggestions?: SuggestionItem[]; // List of existing values from database
}

const EntityPicker: React.FC<EntityPickerProps> = ({
  label,
  placeholder,
  type,
  value,
  onChange,
  className = '',
  lang = 'et',
  localSuggestions = []
}) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<(WikidataSearchResult & { isLocal?: boolean; isViaf?: boolean })[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const justSelectedRef = useRef(false); // Jälgib, kas soovitus just valiti

  // Sync internal input with external value
  useEffect(() => {
    if (!value) {
      setInputValue('');
    } else {
      setInputValue(getLabel(value, lang));
    }
  }, [value, lang]);

  // Handle outside clicks
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (inputValue && showSuggestions && (!value || (typeof value === 'string' ? value : value.label) !== inputValue)) {
        setIsLoading(true);
        
        // 1. Otsi kohalikest soovitustest
        const normalizedInput = inputValue.toLowerCase();
        const localDbText = lang === 'en' ? 'Local database' : 'Kohalik andmebaas';
        const linkedText = lang === 'en' ? 'linked' : 'seotud';
        const unlinkedText = lang === 'en' ? 'unlinked' : 'sidumata';
        const localMatches: (WikidataSearchResult & { isLocal: boolean })[] = localSuggestions
          .filter(s => s.label.toLowerCase().includes(normalizedInput))
          .slice(0, 5) // Piira kohalike arvu
          .map(s => ({
            id: s.id || ('local-' + s.label), // Kasuta päris ID-d kui on, muidu local-
            label: s.label,
            description: s.id ? `${localDbText} (${linkedText}: ${s.id})` : `${localDbText} (${unlinkedText})`,
            url: '',
            isLocal: true
          }));

        // 2. Otsi Wikidatast
        let wikidataMatches: WikidataSearchResult[] = [];
        try {
           wikidataMatches = await searchWikidata(inputValue);
        } catch (e) {
           console.error("Wikidata search error", e);
        }

        // 3. Otsi VIAF-ist (ainult isikute puhul)
        let viafMatches: (WikidataSearchResult & { isViaf: boolean })[] = [];
        if (type === 'person' || type === 'printer') {
          try {
            const viafResults = await searchViaf(inputValue);
            viafMatches = viafResults.map(v => ({
              id: v.id,
              label: v.label,
              description: v.description,
              url: v.url,
              isViaf: true
            }));
          } catch (e) {
            console.error("VIAF search error", e);
          }
        }

        // Eemalda duplikaadid: kui kohalikul on SAMA ID mis kaugel, jäta kohalik
        const localIds = new Set(localMatches.filter(m => !m.id.startsWith('local-')).map(m => m.id));
        const filteredWikidata = wikidataMatches.filter(m => !localIds.has(m.id));

        setSuggestions([...localMatches, ...viafMatches, ...filteredWikidata]);
        setIsLoading(false);
        setSelectedIndex(0);
      } else {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue, showSuggestions, value, localSuggestions]);

  const handleSelect = async (result: WikidataSearchResult & { isViaf?: boolean }) => {
    justSelectedRef.current = true; // Märgi, et valiti soovitus
    setIsLoading(true);

    let entity: LinkedEntity;

    if (result.id.startsWith('local-')) {
        // Kohalik SIDUMATA valik (tekstipõhine)
        entity = {
            id: null,
            label: result.label,
            source: 'manual',
            labels: { et: result.label }
        };
    } else if (result.isViaf || result.id.startsWith('VIAF:')) {
        // VIAF valik
        entity = {
            id: result.id,
            label: result.label,
            source: 'viaf',
            labels: { et: result.label }
        };
    } else {
        // Wikidata või Kohalik SEOTUD valik
        // Igal juhul pärime Wikidatast värsked labelid, et tagada andmete kvaliteet
        // (või kui see on kohalik ja meil pole võrguühendust, võiks fallbackida)
        let multilingualLabels: Record<string, string> = { et: result.label };
        try {
            multilingualLabels = await getEntityLabels(result.id);
        } catch (e) {
            console.warn("Ei saanud silte Wikidatast", e);
        }

        entity = {
            id: result.id,
            label: result.label, // Kasutame valitud labelit (võib olla kohalik)
            source: 'wikidata',
            labels: multilingualLabels
        };
    }

    onChange(entity);
    // Kui value on null (nt märksõnade lisamisel), tühjenda lahter
    // Kui value on olemas (nt üksiku välja muutmisel), näita valitud teksti
    setInputValue(value === null ? '' : result.label);
    setShowSuggestions(false);
    setIsLoading(false);
  };

  const handleManualEntry = () => {
    if (!inputValue.trim()) {
      onChange(null);
      return;
    }

    // Kui on olemasolev lingitud entiteet (ID olemas), säilita link ja muuda ainult nime
    const existingId = value && typeof value !== 'string' ? value.id : null;
    const existingSource = value && typeof value !== 'string' ? value.source : null;

    const entity: LinkedEntity = {
      id: existingId,
      label: inputValue.trim(),
      source: existingId ? (existingSource || 'manual') : 'manual',
      labels: { et: inputValue.trim() }
    };

    onChange(entity);
    // Kui value on null (nt märksõnade lisamisel), tühjenda lahter
    if (value === null) {
      setInputValue('');
    }
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length)); // +1 for manual entry option
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex < suggestions.length) {
        handleSelect(suggestions[selectedIndex]);
      } else {
        handleManualEntry();
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
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => {
            // Kui kasutaja lahkub väljalt ja väärtus on muutunud, rakenda muudatus
            // Kui just valiti soovitus, ära tee midagi (justSelectedRef)
            if (justSelectedRef.current) {
              justSelectedRef.current = false;
              return;
            }
            const currentLabel = value ? (typeof value === 'string' ? value : value.label) : '';
            if (inputValue.trim() !== currentLabel) {
              handleManualEntry();
            }
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
            title="Vaata Wikidatas"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={14} />
          </a>
        )}

        {inputValue && (
          <button
            onClick={() => {
              setInputValue('');
              onChange(null);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full hover:bg-gray-100"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showSuggestions && (inputValue.length >= 2 || suggestions.length > 0) && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden max-h-72 flex flex-col">
          <div className="overflow-y-auto flex-1">
            {suggestions.map((result, idx) => {
              const isLocal = result.isLocal;
              const isViaf = result.isViaf || result.id.startsWith('VIAF:');
              return (
              <button
                key={result.id}
                onMouseDown={() => { justSelectedRef.current = true; }}
                onClick={() => handleSelect(result)}
                className={`w-full text-left px-4 py-2 hover:bg-gray-50 border-b border-gray-50 flex flex-col ${
                  idx === selectedIndex ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {isLocal && <Database size={12} className="text-amber-600" title={lang === 'en' ? 'Local database' : 'Kohalik andmebaas'} />}
                    {isViaf && <Library size={12} className="text-purple-600" title="VIAF" />}
                    <span className="font-medium text-gray-900 text-sm">{result.label}</span>
                  </div>
                  {!isLocal && <span className={`text-[10px] font-mono px-1 rounded ${isViaf ? 'text-purple-500 bg-purple-50' : 'text-gray-400 bg-gray-100'}`}>{result.id}</span>}
                </div>
                {result.description && (
                  <span className={`text-xs line-clamp-1 ${isLocal ? 'text-amber-600/80 italic' : isViaf ? 'text-purple-500/80' : 'text-gray-500'}`}>{result.description}</span>
                )}
              </button>
            )})}
            
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
              {(type === 'person' || type === 'printer') && <span className="flex items-center gap-1"><Library size={10} className="text-purple-500" /> VIAF</span>}
            </span>
            {selectedIndex < suggestions.length && suggestions[selectedIndex] && suggestions[selectedIndex].url && (
              <a
                href={suggestions[selectedIndex].url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary-600 hover:underline flex items-center gap-1"
                onClick={e => e.stopPropagation()}
              >
                {lang === 'en' ? 'View' : 'Vaata'} <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityPicker;
