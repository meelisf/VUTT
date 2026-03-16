import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Save, Plus, X, ChevronDown, ChevronRight, Loader2, ImagePlus, Trash2, Link2 } from 'lucide-react';
import Header from '../../components/Header';
import EntityPicker from '../../components/EntityPicker';
import { getPerson, createPerson, updatePerson, uploadPersonImage, deletePersonImage, listPersons } from '../services/prosopographyService';
import { useUser } from '../../contexts/UserContext';
import type { ProsopoRecord, ProsopoIndexEntry } from '../types';
import type { LinkedEntity } from '../../types/LinkedEntity';

// =========================================================
// Vorm tüübid
// =========================================================

interface DateDraft {
  year: string;       // '1650' vm tühi
  month: string;      // '1'–'12' vm tühi
  day: string;        // '1'–'31' vm tühi
  circa: boolean;
  bound: '' | 'before' | 'after';
  calendar: '' | 'julian' | 'gregorian';
  place: string;
}

interface OccupationDraft {
  label: string; id?: string | null; labels?: Record<string, string>;
  institution?: string; institution_id?: string | null; institution_labels?: Record<string, string>;
  year_from?: string; year_to?: string;
}
interface EducationDraft {
  institution: string; institution_id?: string | null; institution_labels?: Record<string, string>;
  year_from?: string; year_to?: string;
}
interface TagDraft { label: string; id?: string | null; labels?: Record<string, string> }
interface RelationDraft  { name: string; type: string; target_id?: string | null }
interface SourceDraft   { text: string; note: string }

interface FormDraft {
  name_label: string;
  name_family: string;
  name_first: string;
  name_qualifier: string;
  name_aliases: string[];
  gender: '' | 'M' | 'F';
  birth: DateDraft;
  death: DateDraft;
  origin_city: LinkedEntity | null;
  origin_region: LinkedEntity | null;
  floruit_from: string;
  floruit_to: string;
  status: LinkedEntity | null;
  confession: LinkedEntity | null;
  occupations: OccupationDraft[];
  education: EducationDraft[];
  tags: TagDraft[];
  relations: RelationDraft[];
  sources: SourceDraft[];
  biography: string;
  notes: string;
  wikidata_id: string;
  gnd_id: string;
  viaf_id: string;
  aa_id: string;
}

const emptyDraft = (): FormDraft => ({
  name_label: '',
  name_family: '',
  name_first: '',
  name_qualifier: '',
  name_aliases: [],
  gender: '',
  birth: { year: '', month: '', day: '', circa: false, bound: '', calendar: '', place: '' },
  death: { year: '', month: '', day: '', circa: false, bound: '', calendar: '', place: '' },
  origin_city: null,
  origin_region: null,
  floruit_from: '',
  floruit_to: '',
  status: null,
  confession: null,
  occupations: [],
  education: [],
  tags: [],
  relations: [],
  sources: [],
  biography: '',
  notes: '',
  wikidata_id: '',
  gnd_id: '',
  viaf_id: '',
  aa_id: '',
});

function recordToDraft(p: ProsopoRecord): FormDraft {
  const ident = (scheme: string) =>
    p.identifiers?.find(i => i.scheme === scheme)?.id ?? '';
  return {
    name_label: p.name.label ?? '',
    name_family: p.name.family_name ?? '',
    name_first: p.name.first_name ?? '',
    name_qualifier: p.name.qualifier ?? '',
    name_aliases: p.name.aliases ?? [],
    gender: p.gender ?? '',
    birth: {
      year: p.birth?.date ? p.birth.date.slice(0, 4) : '',
      month: p.birth?.date && p.birth.precision !== 'year' ? String(parseInt(p.birth.date.slice(5, 7))) : '',
      day: p.birth?.date && p.birth.precision === 'day' ? String(parseInt(p.birth.date.slice(8, 10))) : '',
      circa: p.birth?.is_circa ?? false,
      bound: p.birth?.bound ?? '',
      calendar: (p.birth?.calendar ?? '') as DateDraft['calendar'],
      place: p.birth?.place?.label ?? '',
    },
    death: {
      year: p.death?.date ? p.death.date.slice(0, 4) : '',
      month: p.death?.date && p.death.precision !== 'year' ? String(parseInt(p.death.date.slice(5, 7))) : '',
      day: p.death?.date && p.death.precision === 'day' ? String(parseInt(p.death.date.slice(8, 10))) : '',
      circa: p.death?.is_circa ?? false,
      bound: p.death?.bound ?? '',
      calendar: (p.death?.calendar ?? '') as DateDraft['calendar'],
      place: p.death?.place?.label ?? '',
    },
    origin_city: p.origin?.city ? { label: p.origin.city, id: p.origin.city_id ?? null, labels: p.origin.city_labels ?? null, source: 'wikidata' } : null,
    origin_region: p.origin?.region ? { label: p.origin.region, id: p.origin.region_id ?? null, labels: p.origin.region_labels ?? null, source: 'wikidata' } : null,
    floruit_from: p.floruit?.year_from ? String(p.floruit.year_from) : '',
    floruit_to: p.floruit?.year_to ? String(p.floruit.year_to) : '',
    status: p.status ? { label: p.status.label, id: p.status.id, labels: (p.status as any).labels ?? null, source: 'wikidata' } : null,
    confession: p.confession ? { label: p.confession.label, id: p.confession.id, labels: (p.confession as any).labels ?? null, source: 'wikidata' } : null,
    occupations: (p.occupations ?? []).map((o: any) => ({
      label: o.label ?? String(o), id: o.id ?? null, labels: o.labels ?? undefined,
      institution: o.institution ?? '', institution_id: o.institution_id ?? null, institution_labels: o.institution_labels ?? undefined,
      year_from: o.year_from ? String(o.year_from) : (o.year ? String(o.year) : ''),
      year_to: o.year_to ? String(o.year_to) : '',
    })),
    education: (p.education ?? []).map((e: any) => ({
      institution: e.institution ?? e.label ?? String(e),
      institution_id: e.institution_id ?? null, institution_labels: e.institution_labels ?? undefined,
      year_from: e.year_from ? String(e.year_from) : (e.year ? String(e.year) : ''),
      year_to: e.year_to ? String(e.year_to) : '',
    })),
    tags: (p.tags ?? []).map((t: any) => ({ label: t.label ?? String(t), id: t.id ?? null, labels: t.labels ?? undefined })),
    relations: (p.relations ?? []).map((r: any) => ({ name: r.name ?? '', type: r.type ?? '', target_id: r.target_id ?? null })),
    sources: (p.sources ?? []).map((s: any) => ({ text: s.text ?? String(s), note: s.note ?? '' })),
    biography: p.biography ?? '',
    notes: p.notes ?? '',
    wikidata_id: ident('wikidata'),
    gnd_id: ident('gnd'),
    viaf_id: ident('viaf'),
    aa_id: ident('album_academicum'),
  };
}

function buildDatePayload(d: DateDraft): any {
  if (!d.year) return null;
  const y = d.year.padStart(4, '0');
  const m = d.month ? d.month.padStart(2, '0') : '01';
  const day = d.day ? d.day.padStart(2, '0') : '01';
  const precision = d.day && d.month ? 'day' : d.month ? 'month' : 'year';
  return {
    original_text: null,
    date: `${y}-${m}-${day}`,
    date_to: null,
    bound: d.bound || null,
    precision,
    calendar: d.calendar || null,
    is_circa: d.circa,
    place: d.place ? { id: null, label: d.place } : null,
    notes: null,
  };
}

function draftToPayload(draft: FormDraft, original?: ProsopoRecord): Partial<ProsopoRecord> {
  // Identifikaatorid — säilita olemasolevad, uuenda/lisa muudetud
  const existing = original?.identifiers ?? [];
  const schemes: { scheme: string; key: keyof FormDraft }[] = [
    { scheme: 'wikidata', key: 'wikidata_id' },
    { scheme: 'gnd', key: 'gnd_id' },
    { scheme: 'viaf', key: 'viaf_id' },
    { scheme: 'album_academicum', key: 'aa_id' },
  ];
  const identifiers = schemes
    .map(({ scheme, key }) => {
      const val = (draft[key] as string).trim();
      if (!val) return null;
      const found = existing.find(i => i.scheme === scheme);
      return { scheme, id: val, checked_at: found?.checked_at ?? null };
    })
    .filter(Boolean) as ProsopoRecord['identifiers'];

  return {
    name: {
      label: draft.name_label.trim(),
      family_name: draft.name_family.trim() || null,
      first_name: draft.name_first.trim() || null,
      qualifier: draft.name_qualifier.trim() || null,
      qualifier_type: original?.name?.qualifier_type ?? null,
      noble_status: original?.name?.noble_status ?? null,
      maiden_name: original?.name?.maiden_name ?? null,
      aliases: draft.name_aliases.filter(Boolean),
      family_name_variants: original?.name?.family_name_variants ?? [],
      first_name_variants: original?.name?.first_name_variants ?? [],
    },
    gender: (draft.gender || null) as 'M' | 'F' | null,
    birth: buildDatePayload(draft.birth) ?? (original?.birth ?? null as any),
    death: buildDatePayload(draft.death) ?? (original?.death ?? null as any),
    status: draft.status
      ? { id: draft.status.id || draft.status.label, label: draft.status.label, ...(draft.status.labels ? { labels: draft.status.labels } : {}) }
      : null,
    confession: draft.confession
      ? { id: draft.confession.id || draft.confession.label, label: draft.confession.label, ...(draft.confession.labels ? { labels: draft.confession.labels } : {}) }
      : null,
    origin: {
      city: draft.origin_city?.label ?? null,
      city_id: draft.origin_city?.id ?? null,
      city_labels: draft.origin_city?.labels ?? null,
      region: draft.origin_region?.label ?? null,
      region_id: draft.origin_region?.id ?? null,
      region_labels: draft.origin_region?.labels ?? null,
      geonames_id: original?.origin?.geonames_id ?? null,
      coordinates: original?.origin?.coordinates ?? null,
    },
    floruit: (draft.floruit_from || draft.floruit_to) ? {
      year_from: draft.floruit_from ? parseInt(draft.floruit_from) : null,
      year_to: draft.floruit_to ? parseInt(draft.floruit_to) : null,
    } : null,
    occupations: draft.occupations.filter(o => o.label.trim()).map(o => ({
      label: o.label.trim(),
      ...(o.id ? { id: o.id } : {}),
      ...(o.labels ? { labels: o.labels } : {}),
      ...(o.institution?.trim() ? { institution: o.institution.trim() } : {}),
      ...(o.institution_id ? { institution_id: o.institution_id } : {}),
      ...(o.institution_labels ? { institution_labels: o.institution_labels } : {}),
      ...(o.year_from?.trim() ? { year_from: parseInt(o.year_from) } : {}),
      ...(o.year_to?.trim() ? { year_to: parseInt(o.year_to) } : {}),
    })),
    education: draft.education.filter(e => e.institution.trim()).map(e => ({
      institution: e.institution.trim(),
      ...(e.institution_id ? { institution_id: e.institution_id } : {}),
      ...(e.institution_labels ? { institution_labels: e.institution_labels } : {}),
      ...(e.year_from?.trim() ? { year_from: parseInt(e.year_from) } : {}),
      ...(e.year_to?.trim() ? { year_to: parseInt(e.year_to) } : {}),
    })),
    tags: draft.tags.filter(t => t.label.trim()).map(t => ({
      label: t.label.trim(),
      ...(t.id ? { id: t.id } : {}),
      ...(t.labels ? { labels: t.labels } : {}),
    })) as any,
    relations: draft.relations.filter(r => r.name.trim() || r.target_id).map(r => ({
      name: r.name.trim(),
      ...(r.type.trim() ? { type: r.type.trim() } : {}),
      ...(r.target_id ? { target_id: r.target_id } : {}),
    })),
    sources: draft.sources.filter(s => s.text.trim()).map(s => ({
      text: s.text.trim(),
      ...(s.note.trim() ? { note: s.note.trim() } : {}),
    })),
    biography: draft.biography.trim() || null,
    notes: draft.notes.trim() || null,
    identifiers,
    ...(original ? { updated_at: original.updated_at } : {}),
  };
}

// =========================================================
// Kuupäevaväli — aasta esikohal, täpsem info klapitav
// =========================================================
const DateField: React.FC<{
  label: string;
  value: DateDraft;
  onChange: (v: DateDraft) => void;
}> = ({ label, value, onChange }) => {
  const set = (patch: Partial<DateDraft>) => onChange({ ...value, ...patch });

  // Avatud kui on täpsemaid välju täidetud
  const hasDetail = !!(value.month || value.day || value.circa || value.bound || value.calendar || value.place);
  const [open, setOpen] = useState(hasDetail);

  // Kokkuvõte näidatakse kui detail on olemas aga paneel suletud
  const summary = (() => {
    const parts: string[] = [];
    if (value.circa) parts.push('~');
    if (value.bound === 'before') parts.push('enne');
    if (value.bound === 'after') parts.push('pärast');
    if (value.month) parts.push(value.day ? `${value.day}.${value.month}` : `kuu ${value.month}`);
    if (value.calendar === 'julian') parts.push('jul.');
    if (value.calendar === 'gregorian') parts.push('greg.');
    if (value.place) parts.push(value.place);
    return parts.join(' ');
  })();

  const inputCls = "px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white";

  return (
    <div>
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</label>

      {/* Peamine rida: aasta + avamise nupp */}
      <div className="flex items-center gap-2">
        <input
          type="number" min={1000} max={1900}
          placeholder="aasta"
          value={value.year}
          onChange={e => set({ year: e.target.value })}
          className={`w-20 ${inputCls}`}
        />
        {/* Kokkuvõte kui detail olemas aga suletud */}
        {!open && summary && (
          <span className="text-xs text-gray-400 italic truncate max-w-[120px]">{summary}</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className={`ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors
            ${open
              ? 'text-primary-600 bg-primary-50 border border-primary-200'
              : 'text-gray-400 border border-gray-200 hover:text-gray-600 hover:border-gray-300'}`}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          täpsem
        </button>
      </div>

      {/* Täpsem info — klapitav */}
      {open && (
        <div className="mt-2 pl-3 border-l-2 border-gray-200 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number" min={1} max={12}
              placeholder="kuu"
              value={value.month}
              onChange={e => set({ month: e.target.value })}
              className={`w-14 ${inputCls}`}
            />
            <input
              type="number" min={1} max={31}
              placeholder="päev"
              value={value.day}
              onChange={e => set({ day: e.target.value })}
              className={`w-14 ${inputCls}`}
            />
            <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={value.circa}
                onChange={e => set({ circa: e.target.checked })}
                className="accent-primary-600"
              />
              <span className="font-mono">~</span> ligikaudu
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={value.bound}
              onChange={e => set({ bound: e.target.value as DateDraft['bound'] })}
              className={`${inputCls}`}
            >
              <option value="">täpne kuupäev</option>
              <option value="before">enne seda</option>
              <option value="after">pärast seda</option>
            </select>
            <select
              value={value.calendar}
              onChange={e => set({ calendar: e.target.value as DateDraft['calendar'] })}
              className={`${inputCls}`}
            >
              <option value="">kalender märkimata</option>
              <option value="julian">Juliuse kalender</option>
              <option value="gregorian">Gregoriuse kalender</option>
            </select>
            <input
              type="text"
              placeholder="koht"
              value={value.place}
              onChange={e => set({ place: e.target.value })}
              className={`w-28 ${inputCls}`}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// =========================================================
// Nimevariandid — tag-list
// =========================================================
const AliasesList: React.FC<{
  aliases: string[];
  onChange: (v: string[]) => void;
}> = ({ aliases, onChange }) => {
  const [input, setInput] = useState('');

  const add = () => {
    const v = input.trim();
    if (v && !aliases.includes(v)) onChange([...aliases, v]);
    setInput('');
  };

  const remove = (i: number) => onChange(aliases.filter((_, j) => j !== i));

  return (
    <div>
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">Nimevariandid</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {aliases.map((a, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded"
          >
            {a}
            <button onClick={() => remove(i)} className="text-gray-400 hover:text-gray-700 transition-colors">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Lisa variant…"
          className="flex-1 text-sm px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!input.trim()}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          <Plus size={12} /> Lisa
        </button>
      </div>
    </div>
  );
};

// =========================================================
// ProsopoPersonPicker — otsib vutt:P isikuid seose jaoks
// =========================================================
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

  // Sulge dropdown väljaklõpsel
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

// =========================================================
// TagsList — LinkedEntity märksõnade loend
// =========================================================
const TagsList: React.FC<{
  tags: TagDraft[];
  onChange: (v: TagDraft[]) => void;
}> = ({ tags, onChange }) => {
  const [pickerValue, setPickerValue] = useState<any>(null);

  const add = (v: any) => {
    if (!v?.label?.trim()) return;
    const tag: TagDraft = { label: v.label, id: v.id ?? null, labels: v.labels ?? undefined };
    onChange([...tags, tag]);
    setPickerValue(null);
  };

  const remove = (i: number) => onChange(tags.filter((_, j) => j !== i));

  return (
    <div>
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">Märksõnad</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-primary-50 text-primary-700 border border-primary-200 rounded"
          >
            {tag.label}
            {tag.id && <span className="text-primary-400 font-mono">{tag.id}</span>}
            <button onClick={() => remove(i)} className="text-primary-400 hover:text-primary-700 transition-colors ml-0.5">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <EntityPicker
        placeholder="kreeka keele professor, jesuiit…"
        type="topic"
        value={pickerValue}
        onChange={v => { if (v) add(v); else setPickerValue(null); }}
        lang="et"
      />
    </div>
  );
};

// =========================================================
// CollapsibleSection — ühtne klapitav kaart
// =========================================================
const CollapsibleSection: React.FC<{
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, open, onToggle, children }) => (
  <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-5">
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-5 py-4 text-gray-700 hover:text-primary-700 transition-colors"
    >
      <span className="font-bold text-sm capitalize-first">{title}</span>
      <span className="ml-auto text-gray-400">
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </span>
    </button>
    {open && (
      <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-5">
        {children}
      </div>
    )}
  </div>
);

// =========================================================
// DynamicList — üldine dünaamiline massiiv
// =========================================================
function DynamicList<T>({
  label, items, renderItem, onAdd, onChange,
}: {
  label: string;
  items: T[];
  renderItem: (item: T, onChange: (v: T) => void, onRemove: () => void) => React.ReactNode;
  onAdd: () => void;
  onChange: (items: T[]) => void;
}): React.ReactElement {
  const updateItem = (i: number, v: T) => {
    const next = [...items];
    next[i] = v;
    onChange(next);
  };
  const removeItem = (i: number) => onChange(items.filter((_, j) => j !== i));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs text-gray-500 uppercase tracking-wide">{label}</label>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <Plus size={11} /> Lisa
        </button>
      </div>
      {items.length === 0 && (
        <p className="text-xs text-gray-400 italic">Kirjeid pole. Klõpsa "Lisa" lisamiseks.</p>
      )}
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i}>{renderItem(item, v => updateItem(i, v), () => removeItem(i))}</div>
        ))}
      </div>
    </div>
  );
}

// =========================================================
// PersonEditPage
// =========================================================
const PersonEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(['common']);
  const { user, authToken } = useUser();

  const isNew = !id || id === 'new';
  const token = authToken ?? '';

  const [original, setOriginal] = useState<ProsopoRecord | null>(null);
  const [draft, setDraft] = useState<FormDraft>(emptyDraft());
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namesOpen, setNamesOpen] = useState(false);
  const [occupOpen, setOccupOpen] = useState(false);
  const [relOpen, setRelOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // Profiilipilt
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageDragOver, setImageDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ligipääsukontroll
  const canEdit = user && (user.role === 'editor' || user.role === 'admin');

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    getPerson(id!, token)
      .then(data => {
        setOriginal(data);
        setDraft(recordToDraft(data));
        setImageUrl(data.image_url ?? null);
      })
      .catch(() => setError('Isiku laadimine ebaõnnestus.'))
      .finally(() => setLoading(false));
  }, [id, token]);

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setImageError('Palun vali pildifail (JPEG, PNG, WebP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImageError('Fail on liiga suur (max 10 MB).');
      return;
    }
    if (isNew) {
      setImageError('Salvesta isik esmalt, seejärel lisa pilt.');
      return;
    }
    setImageUploading(true);
    setImageError(null);
    try {
      const result = await uploadPersonImage(id!, file, token);
      setImageUrl(result.image_url);
    } catch (e: any) {
      setImageError(e.message ?? 'Pildi üleslaadimine ebaõnnestus.');
    } finally {
      setImageUploading(false);
    }
  };

  const handleImageDelete = async () => {
    if (!id || isNew) return;
    setImageUploading(true);
    setImageError(null);
    try {
      await deletePersonImage(id, token);
      setImageUrl(null);
    } catch {
      setImageError('Pildi kustutamine ebaõnnestus.');
    } finally {
      setImageUploading(false);
    }
  };

  const set = (patch: Partial<FormDraft>) => setDraft(d => ({ ...d, ...patch }));
  const setBirth = (patch: Partial<DateDraft>) => setDraft(d => ({ ...d, birth: { ...d.birth, ...patch } }));
  const setDeath = (patch: Partial<DateDraft>) => setDraft(d => ({ ...d, death: { ...d.death, ...patch } }));

  const handleSave = async () => {
    if (!draft.name_label.trim()) { setError('Nimi on kohustuslik.'); return; }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        // Loo uus isik minimaalse andmetega
        const created = await createPerson(
          {
            name: draft.name_label.trim(),
            birth_year: draft.birth.year ? parseInt(draft.birth.year) : undefined,
            death_year: draft.death.year ? parseInt(draft.death.year) : undefined,
            notes: draft.notes.trim() || undefined,
          },
          token,
        );
        // Uuenda täieliku andmetega
        const payload = draftToPayload(draft, created);
        await updatePerson(created.id, { ...payload, updated_at: created.updated_at }, token);
        navigate(`/persons/${encodeURIComponent(created.id)}`);
      } else {
        const payload = draftToPayload(draft, original ?? undefined);
        await updatePerson(id!, payload, token);
        navigate(`/persons/${encodeURIComponent(id!)}`);
      }
    } catch (e: any) {
      if (e?.conflict) {
        setError('Andmeid on vahepeal muudetud. Laadi leht uuesti ja proovi uuesti.');
      } else {
        setError('Salvestamine ebaõnnestus. Kontrolli ühendust ja proovi uuesti.');
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
          {[100, 80, 90, 70].map((w, i) => (
            <div key={i} className="h-10 bg-white rounded-lg border border-gray-200 animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  // ── Ligipääsu puudumine ──────────────────────────────────
  if (!canEdit) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
          <p className="text-gray-600 text-sm mb-4">Muutmiseks pead olema sisse logitud toimetajana.</p>
          <button onClick={() => navigate('/persons')} className="text-primary-600 hover:underline text-sm">
            ← Tagasi isikute nimekirja
          </button>
        </div>
      </div>
    );
  }

  const pageTitle = isNew
    ? t('prosopography.addPerson', 'Lisa isik')
    : original?.name.label ?? t('prosopography.edit', 'Muuda isikut');

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">

        {/* Tagasi */}
        <button
          onClick={() => navigate(isNew ? '/persons' : `/persons/${encodeURIComponent(id!)}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary-600 transition-colors mb-4"
        >
          <ArrowLeft size={15} />
          {isNew ? t('prosopography.backToList', 'Tagasi isikute nimekirja') : 'Tagasi profiilile'}
        </button>

        {/* Pealkiri + salvesta */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold text-gray-900">{pageTitle}</h1>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Salvestamine…' : 'Salvesta'}
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── Profiilipilt ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-3">Profiilipilt</label>
          <div className="flex items-start gap-4">
            {/* Eelvaade */}
            <div
              className={`relative w-24 h-24 rounded-lg border-2 flex items-center justify-center overflow-hidden shrink-0 transition-colors cursor-pointer
                ${imageDragOver ? 'border-primary-400 bg-primary-50' : 'border-dashed border-gray-300 bg-gray-50 hover:border-primary-300 hover:bg-primary-50/40'}`}
              onClick={() => !imageUploading && fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setImageDragOver(true); }}
              onDragLeave={() => setImageDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setImageDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleImageFile(file);
              }}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt="Profiilipilt"
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImagePlus size={24} className="text-gray-300" />
              )}
              {imageUploading && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                  <Loader2 size={18} className="animate-spin text-primary-500" />
                </div>
              )}
            </div>

            {/* Nupud ja selgitus */}
            <div className="flex flex-col gap-2 min-w-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }}
              />
              <button
                type="button"
                disabled={imageUploading || isNew}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                <ImagePlus size={13} />
                {imageUrl ? 'Vaheta pilt' : 'Lisa pilt'}
              </button>
              {imageUrl && (
                <button
                  type="button"
                  disabled={imageUploading}
                  onClick={handleImageDelete}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                >
                  <Trash2 size={13} />
                  Eemalda pilt
                </button>
              )}
              <p className="text-xs text-gray-400 leading-snug">
                JPEG, PNG või WebP, max 10 MB.<br />
                {isNew && <span className="text-amber-600">Salvesta isik esmalt.</span>}
              </p>
              {imageError && <p className="text-xs text-red-600">{imageError}</p>}
            </div>
          </div>
        </div>

        {/* ── Identiteedi kaart ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5 space-y-5">

          {/* Nimi */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
              Kanooniline nimi <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={draft.name_label}
              onChange={e => set({ name_label: e.target.value })}
              placeholder="Anna Margaretha von Fersen"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Eesnimi</label>
            <input
              type="text"
              value={draft.name_first}
              onChange={e => set({ name_first: e.target.value })}
              placeholder="Johann Friedrich Wilhelm"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Perekonnanimi</label>
              <input
                type="text"
                value={draft.name_family}
                onChange={e => set({ name_family: e.target.value })}
                placeholder="von Münchhausen"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Täiend (qualifier)</label>
              <input
                type="text"
                value={draft.name_qualifier}
                onChange={e => set({ name_qualifier: e.target.value })}
                placeholder="von, van, de…"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
          </div>

          {/* Sugu */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">Sugu</label>
            <div className="flex gap-4 text-sm text-gray-700">
              {(['', 'M', 'F'] as const).map(v => (
                <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="gender"
                    value={v}
                    checked={draft.gender === v}
                    onChange={() => set({ gender: v })}
                    className="accent-primary-600"
                  />
                  {v === '' ? 'Teadmata' : v === 'M' ? t('prosopography.filterMale', 'Meessoost') : t('prosopography.filterFemale', 'Naissoost')}
                </label>
              ))}
            </div>
          </div>

          {/* Eluaastad */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DateField
              label={t('prosopography.born', 'Sündinud')}
              value={draft.birth}
              onChange={v => set({ birth: v })}
            />
            <DateField
              label={t('prosopography.died', 'Surnud')}
              value={draft.death}
              onChange={v => set({ death: v })}
            />
          </div>

          {/* Seisus + konfessioon */}
          <div className="grid grid-cols-2 gap-3">
            <EntityPicker
              label={t('prosopography.status', 'Seisus')}
              placeholder="aadlik, vaimulik…"
              type="topic"
              value={draft.status}
              onChange={v => set({ status: v })}
              lang="et"
            />
            <EntityPicker
              label={t('prosopography.confession', 'Konfessioon')}
              placeholder="luterlik, katoliiklik…"
              type="topic"
              value={draft.confession}
              onChange={v => set({ confession: v })}
              lang="et"
            />
          </div>

          {/* Päritolu */}
          <div className="grid grid-cols-2 gap-3">
            <EntityPicker
              label={`${t('prosopography.origin', 'Päritolu')} — linn`}
              placeholder="Tallinn, Riia…"
              type="place"
              value={draft.origin_city}
              onChange={v => set({ origin_city: v })}
              lang="et"
            />
            <EntityPicker
              label={`${t('prosopography.origin', 'Päritolu')} — piirkond`}
              placeholder="Liivimaa, Saksimaa…"
              type="place"
              value={draft.origin_region}
              onChange={v => set({ origin_region: v })}
              lang="et"
            />
          </div>

          {/* Floruit — tegutsemisperiood */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
              Tegutsemisperiood <span className="normal-case font-normal text-gray-400">(floruit, kui sünd/surm teadmata)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={1000} max={1900}
                placeholder="alates"
                value={draft.floruit_from}
                onChange={e => set({ floruit_from: e.target.value })}
                className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
              <span className="text-gray-400">–</span>
              <input
                type="number" min={1000} max={1900}
                placeholder="kuni"
                value={draft.floruit_to}
                onChange={e => set({ floruit_to: e.target.value })}
                className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* ── Elulugu ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">
            {t('prosopography.biography', 'Elulugu')} <span className="font-normal lowercase">(markdown)</span>
          </label>
          <textarea
            value={draft.biography}
            onChange={e => set({ biography: e.target.value })}
            rows={8}
            placeholder="Kirjelda isiku elukäiku…"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none resize-y font-mono leading-relaxed"
          />
        </div>

        {/* ── Nimevariandid ja identifikaatorid (klapitav) ── */}
        <CollapsibleSection
          title="Nimevariandid ja identifikaatorid"
          open={namesOpen}
          onToggle={() => setNamesOpen(v => !v)}
        >
          <AliasesList
            aliases={draft.name_aliases}
            onChange={v => set({ name_aliases: v })}
          />
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">Identifikaatorid</label>
            <div className="space-y-2">
              {[
                { key: 'wikidata_id', label: 'Wikidata', placeholder: 'Q12345' },
                { key: 'gnd_id', label: 'GND', placeholder: '123456789' },
                { key: 'viaf_id', label: 'VIAF', placeholder: '12345678' },
                { key: 'aa_id', label: 'Album Academicum', placeholder: 'AA-123' },
              ].map(({ key, label, placeholder }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-36 shrink-0">{label}</span>
                  <input
                    type="text"
                    value={draft[key as keyof FormDraft] as string}
                    onChange={e => set({ [key]: e.target.value } as Partial<FormDraft>)}
                    placeholder={placeholder}
                    className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        </CollapsibleSection>

        {/* ── Ametid ja haridus (klapitav) ── */}
        <CollapsibleSection
          title={`${t('prosopography.occupations', 'Ametid')} ja ${t('prosopography.education', 'haridus').toLowerCase()}`}
          open={occupOpen}
          onToggle={() => setOccupOpen(v => !v)}
        >
          {/* Ametid */}
          <DynamicList
            label={t('prosopography.occupations', 'Ametid')}
            items={draft.occupations}
            renderItem={(item, onChange, onRemove) => (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-0.5">Amet</label>
                    <EntityPicker
                      placeholder="pastor, jurist, professor…"
                      type="topic"
                      value={item.id ? { label: item.label, id: item.id, labels: item.labels, source: 'wikidata' } : (item.label ? { label: item.label, id: null, labels: null, source: 'manual' } : null)}
                      onChange={v => onChange({ ...item, label: v?.label ?? '', id: v?.id ?? null, labels: v?.labels ?? undefined })}
                      lang="et"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-0.5">Asutus / töökoht</label>
                    <EntityPicker
                      placeholder="Academia Gustaviana…"
                      type="topic"
                      value={item.institution_id ? { label: item.institution ?? '', id: item.institution_id, labels: item.institution_labels, source: 'wikidata' } : (item.institution ? { label: item.institution, id: null, labels: null, source: 'manual' } : null)}
                      onChange={v => onChange({ ...item, institution: v?.label ?? '', institution_id: v?.id ?? null, institution_labels: v?.labels ?? undefined })}
                      lang="et"
                    />
                  </div>
                  <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0 mt-5">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-gray-400 shrink-0">Periood</span>
                  <input
                    type="number" min={1000} max={1900}
                    value={item.year_from ?? ''}
                    onChange={e => onChange({ ...item, year_from: e.target.value })}
                    placeholder="alates"
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                  <span className="text-gray-400">–</span>
                  <input
                    type="number" min={1000} max={1900}
                    value={item.year_to ?? ''}
                    onChange={e => onChange({ ...item, year_to: e.target.value })}
                    placeholder="kuni"
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              </div>
            )}
            onAdd={() => set({ occupations: [...draft.occupations, { label: '' }] })}
            onChange={items => set({ occupations: items })}
          />

          {/* Haridus */}
          <DynamicList
            label={t('prosopography.education', 'Haridus')}
            items={draft.education}
            renderItem={(item, onChange, onRemove) => (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-0.5">Asutus</label>
                    <EntityPicker
                      placeholder="Academia Gustaviana, Wittenberg…"
                      type="topic"
                      value={item.institution_id ? { label: item.institution, id: item.institution_id, labels: item.institution_labels ?? null, source: 'wikidata' } : (item.institution ? { label: item.institution, id: null, labels: null, source: 'manual' } : null)}
                      onChange={v => onChange({ ...item, institution: v?.label ?? '', institution_id: v?.id ?? null, institution_labels: v?.labels ?? undefined })}
                      lang="et"
                    />
                  </div>
                  <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0 mt-5">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 shrink-0">Periood</span>
                  <input
                    type="number" min={1000} max={1900}
                    value={item.year_from ?? ''}
                    onChange={e => onChange({ ...item, year_from: e.target.value })}
                    placeholder="alates"
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                  <span className="text-gray-400">–</span>
                  <input
                    type="number" min={1000} max={1900}
                    value={item.year_to ?? ''}
                    onChange={e => onChange({ ...item, year_to: e.target.value })}
                    placeholder="kuni"
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              </div>
            )}
            onAdd={() => set({ education: [...draft.education, { institution: '' }] })}
            onChange={items => set({ education: items })}
          />

          {/* Märksõnad */}
          <TagsList
            tags={draft.tags}
            onChange={v => set({ tags: v })}
          />
        </CollapsibleSection>

        {/* ── Seosed ja märkmed (klapitav) ── */}
        <CollapsibleSection
          title={`${t('prosopography.relations', 'Seosed')} ja ${t('prosopography.notes', 'märkmed').toLowerCase()}`}
          open={relOpen}
          onToggle={() => setRelOpen(v => !v)}
        >
          {/* Seosed */}
          <DynamicList
            label={t('prosopography.relations', 'Seosed')}
            items={draft.relations}
            renderItem={(item, onChange, onRemove) => (
              <div className="flex items-center gap-2">
                <ProsopoPersonPicker
                  value={item}
                  onChange={onChange}
                  token={token}
                  currentId={id}
                />
                <input
                  type="text"
                  value={item.type}
                  onChange={e => onChange({ ...item, type: e.target.value })}
                  placeholder="suhe (abikaasa, isa…)"
                  className="w-36 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none shrink-0"
                />
                <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0">
                  <X size={14} />
                </button>
              </div>
            )}
            onAdd={() => set({ relations: [...draft.relations, { name: '', type: '', target_id: null }] })}
            onChange={items => set({ relations: items })}
          />

          {/* Märkmed */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t('prosopography.notes', 'Märkmed')}
            </label>
            <textarea
              value={draft.notes}
              onChange={e => set({ notes: e.target.value })}
              rows={3}
              placeholder="Sisemised märkmed (ei kuvata avalikult)…"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none resize-y"
            />
          </div>
        </CollapsibleSection>

        {/* ── Allikad ja bibliograafia (klapitav) ── */}
        <CollapsibleSection
          title="Allikad ja bibliograafia"
          open={sourcesOpen}
          onToggle={() => setSourcesOpen(v => !v)}
        >
          <DynamicList
            label="Allikad"
            items={draft.sources}
            renderItem={(item, onChange, onRemove) => (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={item.text}
                      onChange={e => onChange({ ...item, text: e.target.value })}
                      placeholder="Allikaviide — arhiivifond, trükis, veebiaadress…"
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    />
                  </div>
                  <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0 mt-0.5">
                    <X size={14} />
                  </button>
                </div>
                <input
                  type="text"
                  value={item.note}
                  onChange={e => onChange({ ...item, note: e.target.value })}
                  placeholder={'Märkus — nt \u201esuri 15. jaanuar 1642 Tallinnas\u201c'}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white text-gray-600 italic"
                />
              </div>
            )}
            onAdd={() => set({ sources: [...draft.sources, { text: '', note: '' }] })}
            onChange={items => set({ sources: items })}
          />
        </CollapsibleSection>

        {/* Alumine salvesta nupp */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Salvestamine…' : 'Salvesta'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default PersonEditPage;
