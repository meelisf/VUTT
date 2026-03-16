import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Link2, X } from 'lucide-react';
import { listPersons } from '../../services/prosopographyService';
import type { ProsopoIndexEntry } from '../../types';
import type { RelationDraft } from './types';

const ProsopoPersonPicker: React.FC<{
  value: RelationDraft;
  onChange: (v: RelationDraft) => void;
  token: string;
  currentId?: string;  // välistab iseenda tulemi
}> = ({ value, onChange, token, currentId }) => {
  const [query, setQuery] = useState(value.name);
  const [results, setResults] = useState<ProsopoIndexEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback((q: string) => {
    clearTimeout(timerRef.current);
    if (!q.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await listPersons({ q }, token);
        setResults(res.results.filter(r => r.id !== currentId).slice(0, 8));
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
  }, [token, currentId]);

  const select = (person: ProsopoIndexEntry) => {
    onChange({ ...value, name: person.label, target_id: person.id });
    setQuery(person.label);
    setOpen(false);
    setResults([]);
  };

  const clear = () => {
    onChange({ ...value, name: '', target_id: null });
    setQuery('');
    setResults([]);
  };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              onChange({ ...value, name: e.target.value, target_id: null });
              setOpen(true);
              search(e.target.value);
            }}
            onFocus={() => { if (query) setOpen(true); }}
            placeholder="Isiku nimi…"
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none pr-6"
          />
          {loading && <Loader2 size={12} className="absolute right-2 top-2.5 animate-spin text-gray-400" />}
        </div>
        {value.target_id && (
          <span title={value.target_id} className="shrink-0">
            <Link2 size={13} className="text-primary-500" />
          </span>
        )}
        {(query || value.target_id) && (
          <button type="button" onClick={clear} className="text-gray-300 hover:text-gray-500 shrink-0">
            <X size={13} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => select(p)}
              className="w-full text-left px-3 py-2 hover:bg-primary-50 text-sm flex items-baseline justify-between gap-2"
            >
              <span className="text-gray-800 truncate">{p.label}</span>
              <span className="text-xs text-gray-400 shrink-0">
                {p.birth_year && p.death_year ? `${p.birth_year}–${p.death_year}` : p.birth_year ? `s. ${p.birth_year}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProsopoPersonPicker;
