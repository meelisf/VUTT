import React, { useState, useEffect, useRef } from 'react';
import { Search, Globe, User, MapPin, BookOpen, Tag, X, Loader2, ExternalLink } from 'lucide-react';
import { searchWikidata, getEntityLabels, WikidataSearchResult } from '../services/wikidataService';
import { LinkedEntity } from '../types/LinkedEntity';
import { getLabel } from '../utils/metadataUtils';

interface EntityPickerProps {
  label?: string;
  placeholder?: string;
  type: 'place' | 'person' | 'printer' | 'genre' | 'topic';
  value: string | LinkedEntity | undefined | null;
  onChange: (value: LinkedEntity | null) => void;
  className?: string;
  lang?: string; // Current UI language
}

const EntityPicker: React.FC<EntityPickerProps> = ({
  label,
  placeholder,
  type,
  value,
  onChange,
  className = '',
  lang = 'et'
}) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<WikidataSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
        const results = await searchWikidata(inputValue);
        setSuggestions(results);
        setIsLoading(false);
        setSelectedIndex(0);
      } else {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue, showSuggestions, value]);

  const handleSelect = async (result: WikidataSearchResult) => {
    setIsLoading(true);
    const multilingualLabels = await getEntityLabels(result.id);
    
    const entity: LinkedEntity = {
      id: result.id,
      label: result.label,
      source: 'wikidata',
      labels: multilingualLabels
    };
    
    onChange(entity);
    setInputValue(result.label);
    setShowSuggestions(false);
    setIsLoading(false);
  };

  const handleManualEntry = () => {
    if (!inputValue.trim()) {
      onChange(null);
      return;
    }
    
    const entity: LinkedEntity = {
      id: null,
      label: inputValue.trim(),
      source: 'manual',
      labels: { et: inputValue.trim() }
    };
    
    onChange(entity);
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

  const isLinked = value && typeof value !== 'string' && value.source === 'wikidata';

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
          onKeyDown={handleKeyDown}
          placeholder={placeholder || `Otsi ${label?.toLowerCase() || 'väärtust'}...`}
          className={`w-full pl-10 pr-10 py-2 text-sm border rounded-md outline-none transition-all ${
            isLinked 
              ? 'border-green-200 bg-green-50/30 focus:border-green-400 focus:ring-2 focus:ring-green-100' 
              : 'border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-100'
          }`}
        />
        
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
            {suggestions.map((result, idx) => (
              <button
                key={result.id}
                onClick={() => handleSelect(result)}
                className={`w-full text-left px-4 py-2 hover:bg-gray-50 border-b border-gray-50 flex flex-col ${
                  idx === selectedIndex ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900 text-sm">{result.label}</span>
                  <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1 rounded">{result.id}</span>
                </div>
                {result.description && (
                  <span className="text-xs text-gray-500 line-clamp-1">{result.description}</span>
                )}
              </button>
            ))}
            
            <button
              onClick={handleManualEntry}
              className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-2 text-gray-600 italic ${
                selectedIndex === suggestions.length ? 'bg-primary-50 ring-1 ring-inset ring-primary-200' : ''
              }`}
            >
              <Tag size={14} className="opacity-50" />
              <span className="text-xs">Kasuta käsitsi sisestust: "{inputValue}"</span>
            </button>
          </div>
          
          <div className="bg-gray-50 px-3 py-1.5 border-t border-gray-100 flex justify-between items-center shrink-0">
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider flex items-center gap-1">
              <Globe size={10} /> Wikidata
            </span>
            {selectedIndex < suggestions.length && suggestions[selectedIndex] && (
              <a 
                href={suggestions[selectedIndex].url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[10px] text-primary-600 hover:underline flex items-center gap-1"
                onClick={e => e.stopPropagation()}
              >
                Vaata Wikidatas <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityPicker;
