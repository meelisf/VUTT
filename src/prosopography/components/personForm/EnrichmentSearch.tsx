import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, X, CheckCircle, Globe, BookMarked, Library, ChevronDown, ChevronRight } from 'lucide-react';
import { searchWikidata, WikidataSearchResult } from '../../../services/wikidataService';
import { searchGnd, GndSearchResult } from '../../../services/gndService';
import { searchViaf, ViafSearchResult } from '../../../services/viafService';
import { fetchEnrichmentPreview } from '../../services/prosopographyService';
import type { FormDraft } from './types';
import { applyEnrichmentToDraft } from './helpers';

interface EnrichedWith {
  scheme: string;
  id: string;
  label: string;
  fields: string[];
}

interface Props {
  draft: FormDraft;
  token: string;
  onEnrich: (newDraft: FormDraft, info: EnrichedWith) => void;
}

type ExternalResult = {
  id: string;
  label: string;
  description?: string;
  url?: string;
  scheme: 'wikidata' | 'gnd' | 'viaf';
};

const EnrichmentSearch: React.FC<Props> = ({ draft, token, onEnrich }) => {
  const { t } = useTranslation(['prosopography']);
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState(draft.name_label || '');
  const [results, setResults] = useState<ExternalResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isEnriching, setIsEnriching] = useState<string | null>(null); // enrichimisel oleva kirje ID
  const [searchError, setSearchError] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  const describeAutoFilled = (af: Record<string, any>): string[] => {
    const fields: string[] = [];
    if (af['gender']) fields.push(t('enrich.fieldsBrief.gender'));
    if (af['birth.date']) fields.push(t('enrich.fieldsBrief.birthDate'));
    if (af['death.date']) fields.push(t('enrich.fieldsBrief.deathDate'));
    if (af['birth.place']) fields.push(t('enrich.fieldsBrief.birthPlace'));
    if (af['death.place']) fields.push(t('enrich.fieldsBrief.deathPlace'));
    if (af['_occupations']?.length || af['_occupation_label']) fields.push(t('enrich.fieldsBrief.occupations'));
    if (af['confession']) fields.push(t('enrich.fieldsBrief.confession'));
    if (af['status']) fields.push(t('enrich.fieldsBrief.status'));
    if (af['name.aliases']?.length) fields.push(t('enrich.fieldsBrief.nameAliases'));
    return fields;
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setResults([]);
    setSearchError(null);
    setEnrichError(null);
    try {
      const [wdRes, gndRes, viafRes] = await Promise.allSettled([
        searchWikidata(query),
        searchGnd(query),
        searchViaf(query),
      ]);
      const all: ExternalResult[] = [];
      if (wdRes.status === 'fulfilled') {
        all.push(...(wdRes.value as WikidataSearchResult[]).slice(0, 5).map(r => ({
          id: r.id, label: r.label, description: r.description, url: r.url, scheme: 'wikidata' as const,
        })));
      }
      if (gndRes.status === 'fulfilled') {
        all.push(...(gndRes.value as GndSearchResult[]).slice(0, 3).map(r => ({
          id: r.id.replace(/^GND:/i, ''), label: r.label, description: r.description, url: r.url, scheme: 'gnd' as const,
        })));
      }
      if (viafRes.status === 'fulfilled') {
        all.push(...(viafRes.value as ViafSearchResult[]).slice(0, 2).map(r => ({
          id: r.id.replace(/^VIAF:/i, ''), label: r.label, description: r.description, url: r.url, scheme: 'viaf' as const,
        })));
      }
      setResults(all);
      if (all.length === 0) setSearchError(t('enrich.noResults'));
    } catch {
      setSearchError(t('enrich.searchError'));
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelect = async (result: ExternalResult) => {
    if (result.scheme === 'viaf') {
      // VIAF-il pole rikastust backendis — kasuta ainult nime
      const newDraft = { ...draft, name_label: draft.name_label || result.label };
      onEnrich(newDraft, { scheme: 'viaf', id: result.id, label: result.label, fields: [] });
      return;
    }
    setIsEnriching(result.id);
    setEnrichError(null);
    try {
      const preview = await fetchEnrichmentPreview(result.scheme, result.id, token);
      if (preview.error) {
        setEnrichError(`${t('enrich.errorPrefix')} ${preview.error}`);
        return;
      }
      const newDraft = applyEnrichmentToDraft(preview.auto_filled, draft);
      // Täienda identifikaatorid
      if (result.scheme === 'wikidata') newDraft.wikidata_id = result.id;
      if (result.scheme === 'gnd') newDraft.gnd_id = result.id;
      const fields = describeAutoFilled(preview.auto_filled);
      onEnrich(newDraft, { scheme: result.scheme, id: result.id, label: result.label, fields });
    } catch {
      setEnrichError(t('enrich.enrichError'));
    } finally {
      setIsEnriching(null);
    }
  };

  const schemeIcon = (scheme: string) => {
    if (scheme === 'gnd') return <BookMarked size={11} className="text-orange-500 shrink-0" />;
    if (scheme === 'viaf') return <Library size={11} className="text-purple-500 shrink-0" />;
    return <Globe size={11} className="text-blue-400 shrink-0" />;
  };

  const schemeName = (scheme: string) => {
    if (scheme === 'gnd') return 'GND';
    if (scheme === 'viaf') return 'VIAF';
    return 'Wikidata';
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg mb-5 overflow-hidden">
      {/* Päis */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-blue-100/60 transition-colors"
      >
        <Globe size={14} className="text-blue-500 shrink-0" />
        <span className="text-sm font-medium text-blue-800">{t('enrich.searchTitle')}</span>
        <span className="text-xs text-blue-500 ml-1">Wikidata · GND · VIAF</span>
        <span className="ml-auto text-blue-400">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-blue-200 pt-3 space-y-3">
          {/* Otsinguväli */}
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
              placeholder={t('enrich.searchPlaceholder')}
              className="flex-1 px-3 py-1.5 text-sm border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={isSearching || !query.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              {t('enrich.searchBtn')}
            </button>
          </div>

          {/* Tulemused */}
          {results.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {results.map(result => (
                <button
                  key={`${result.scheme}:${result.id}`}
                  type="button"
                  disabled={!!isEnriching}
                  onClick={() => handleSelect(result)}
                  className="w-full text-left px-3 py-2 rounded border border-blue-100 bg-white hover:bg-blue-50 hover:border-blue-300 transition-colors flex items-start gap-2 group disabled:opacity-50"
                >
                  {isEnriching === result.id
                    ? <Loader2 size={11} className="animate-spin text-blue-500 shrink-0 mt-0.5" />
                    : schemeIcon(result.scheme)
                  }
                  <span className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-800 block truncate">{result.label}</span>
                    {result.description && (
                      <span className="text-xs text-gray-500 block truncate">{result.description}</span>
                    )}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0 mt-0.5">{schemeName(result.scheme)}</span>
                  {result.url && (
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                    >
                      ↗
                    </a>
                  )}
                </button>
              ))}
            </div>
          )}

          {searchError && <p className="text-xs text-red-600">{searchError}</p>}
          {enrichError && <p className="text-xs text-red-600">{enrichError}</p>}

          <p className="text-xs text-blue-500 italic">
            {t('enrich.hint')}
          </p>
        </div>
      )}
    </div>
  );
};

export default EnrichmentSearch;
