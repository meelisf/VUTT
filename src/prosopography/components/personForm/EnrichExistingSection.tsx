import React, { useState } from 'react';
import { Globe, BookMarked, BookOpen, Loader2, RefreshCw, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react';
import { fetchPersonEnrichmentPreview } from '../../services/prosopographyService';
import { applyEnrichmentToDraft } from './helpers';
import type { FormDraft } from './types';

interface Props {
  personId: string;
  wikidataId: string;
  gndId: string;
  aaId: string;
  draft: FormDraft;
  token: string;
  onChange: (newDraft: FormDraft) => void;
  onApplied?: (fields: string[]) => void;
}

const FIELD_LABELS: Record<string, string> = {
  gender: 'Sugu',
  'birth.date': 'Sünnikuupäev',
  'death.date': 'Surmakuupäev',
  'birth.place': 'Sünnikoht',
  'death.place': 'Surmakoht',
  _occupations: 'Ametid',
  _occupation_label: 'Amet',
  confession: 'Konfessioon',
  status: 'Seisus',
  'name.label': 'Kanooniline nimi',
  'name.aliases': 'Nimevariandid',
};

function formatVal(val: any): string {
  if (val === null || val === undefined) return '—';
  if (Array.isArray(val)) {
    return val.map(v => (typeof v === 'object' ? v.label ?? JSON.stringify(v) : String(v))).join(', ');
  }
  if (typeof val === 'object') return val.label ?? JSON.stringify(val);
  if (val === 'M') return 'Meessoost';
  if (val === 'F') return 'Naissoost';
  return String(val);
}

const GENDER_LABELS: Record<string, string> = { M: 'Meessoost', F: 'Naissoost' };

type DiffResult = {
  auto_filled: Record<string, any>;
  conflicts: { field: string; local: any; remote: any }[];
  error?: string;
};

const EnrichExistingSection: React.FC<Props> = ({ personId, wikidataId, gndId, aaId, draft, token, onChange, onApplied }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [activeScheme, setActiveScheme] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appliedFields, setAppliedFields] = useState<string[] | null>(null);

  const schemes = [
    ...(wikidataId ? [{ scheme: 'wikidata', label: 'Wikidata', icon: <Globe size={12} className="text-blue-500" /> }] : []),
    ...(gndId ? [{ scheme: 'gnd', label: 'GND', icon: <BookMarked size={12} className="text-orange-500" /> }] : []),
    ...(aaId ? [{ scheme: 'album_academicum', label: 'Album Academicum', icon: <BookOpen size={12} className="text-purple-500" /> }] : []),
  ];

  if (schemes.length === 0) return null;

  const handleFetch = async (scheme: string) => {
    setLoading(scheme);
    setDiff(null);
    setError(null);
    setActiveScheme(scheme);
    try {
      const result = await fetchPersonEnrichmentPreview(personId, scheme, token);
      if (result.error) { setError(result.error); return; }
      setDiff(result);
    } catch {
      setError('Rikastamine ebaõnnestus. Kontrolli ühendust.');
    } finally {
      setLoading(null);
    }
  };

  const handleApply = () => {
    if (!diff) return;
    const newDraft = applyEnrichmentToDraft(diff.auto_filled, draft);
    onChange(newDraft);
    const fields = autoKeys.map(k => FIELD_LABELS[k] ?? k);
    setAppliedFields(fields);
    onApplied?.(autoKeys);
    setDiff(null);
    setActiveScheme(null);
  };

  const autoKeys = Object.keys(diff?.auto_filled ?? {}).filter(k => diff!.auto_filled[k] !== null && diff!.auto_filled[k] !== undefined);
  const conflicts = diff?.conflicts ?? [];

  return (
    <div className="mt-3 border border-blue-100 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50/60 hover:bg-blue-50 text-left transition-colors"
      >
        <RefreshCw size={12} className="text-blue-400 shrink-0" />
        <span className="text-xs font-medium text-blue-700">Rikastad välisallikatest</span>
        <span className="ml-auto text-blue-300">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>

      {open && (
        <div className="px-3 py-3 space-y-3 bg-white border-t border-blue-100">
          {/* Allikasd nupud */}
          <div className="flex gap-2">
            {schemes.map(({ scheme, label, icon }) => (
              <button
                key={scheme}
                type="button"
                disabled={!!loading}
                onClick={() => handleFetch(scheme)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {loading === scheme ? <Loader2 size={11} className="animate-spin" /> : icon}
                {label}
              </button>
            ))}
          </div>

          {appliedFields && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1.5">
              ✓ Rakendatud: {appliedFields.join(', ')}
            </p>
          )}

          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle size={11} /> {error}
            </p>
          )}

          {diff && (
            <div className="space-y-2">
              {/* Auto-täidetavad väljad */}
              {autoKeys.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                    Täidetakse ({schemes.find(s => s.scheme === activeScheme)?.label ?? activeScheme})
                  </p>
                  <div className="space-y-1">
                    {autoKeys.map(k => (
                      <div key={k} className="flex items-baseline gap-2 text-xs">
                        <span className="text-gray-400 w-28 shrink-0">{FIELD_LABELS[k] ?? k}</span>
                        <span className="text-gray-800">{formatVal(diff.auto_filled[k])}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Konfliktid */}
              {conflicts.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-amber-600 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <AlertTriangle size={10} /> Konfliktid (uuenda käsitsi)
                  </p>
                  <div className="space-y-1.5">
                    {conflicts.map(c => (
                      <div key={c.field} className="text-xs bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                        <span className="font-medium text-gray-600">{FIELD_LABELS[c.field] ?? c.field}: </span>
                        <span className="text-gray-500 line-through mr-1">{formatVal(c.local)}</span>
                        <span className="text-amber-700">→ {formatVal(c.remote)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {autoKeys.length === 0 && conflicts.length === 0 && (
                <p className="text-xs text-gray-400 italic">Uut infot ei leitud.</p>
              )}

              {autoKeys.length > 0 && (
                <button
                  type="button"
                  onClick={handleApply}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw size={11} />
                  Rakenda auto-täide ({autoKeys.length} välja)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EnrichExistingSection;
