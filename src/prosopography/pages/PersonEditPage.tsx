import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Save, Plus, X, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import Header from '../../components/Header';
import { getPerson, createPerson, updatePerson } from '../services/prosopographyService';
import { useUser } from '../../contexts/UserContext';
import type { ProsopoRecord } from '../types';

// =========================================================
// Vorm tüübid
// =========================================================

interface DateDraft {
  year: string;       // '1650' vm tühi
  circa: boolean;
  bound: '' | 'before' | 'after';
  place: string;
}

interface OccupationDraft { label: string }
interface EducationDraft { institution: string; year: string }
interface RelationDraft  { name: string; type: string }

interface FormDraft {
  name_label: string;
  name_family: string;
  name_first: string;
  name_qualifier: string;
  name_aliases: string[];
  gender: '' | 'M' | 'F';
  birth: DateDraft;
  death: DateDraft;
  origin_city: string;
  origin_region: string;
  status_label: string;
  status_id: string;
  confession_label: string;
  confession_id: string;
  occupations: OccupationDraft[];
  education: EducationDraft[];
  relations: RelationDraft[];
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
  birth: { year: '', circa: false, bound: '', place: '' },
  death: { year: '', circa: false, bound: '', place: '' },
  origin_city: '',
  origin_region: '',
  status_label: '',
  status_id: '',
  confession_label: '',
  confession_id: '',
  occupations: [],
  education: [],
  relations: [],
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
      circa: p.birth?.is_circa ?? false,
      bound: p.birth?.bound ?? '',
      place: p.birth?.place?.label ?? '',
    },
    death: {
      year: p.death?.date ? p.death.date.slice(0, 4) : '',
      circa: p.death?.is_circa ?? false,
      bound: p.death?.bound ?? '',
      place: p.death?.place?.label ?? '',
    },
    origin_city: p.origin?.city ?? '',
    origin_region: p.origin?.region ?? '',
    status_label: p.status?.label ?? '',
    status_id: p.status?.id ?? '',
    confession_label: p.confession?.label ?? '',
    confession_id: p.confession?.id ?? '',
    occupations: (p.occupations ?? []).map((o: any) => ({ label: o.label ?? String(o) })),
    education: (p.education ?? []).map((e: any) => ({ institution: e.institution ?? e.label ?? String(e), year: e.year ? String(e.year) : '' })),
    relations: (p.relations ?? []).map((r: any) => ({ name: r.name ?? r.target_id ?? '', type: r.type ?? '' })),
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
  return {
    original_text: null,
    date: `${d.year.padStart(4, '0')}-01-01`,
    date_to: null,
    bound: d.bound || null,
    precision: 'year',
    calendar: null,
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
    status: draft.status_label.trim()
      ? { id: draft.status_id.trim() || draft.status_label.trim(), label: draft.status_label.trim() }
      : null,
    confession: draft.confession_label.trim()
      ? { id: draft.confession_id.trim() || draft.confession_label.trim(), label: draft.confession_label.trim() }
      : null,
    origin: {
      city: draft.origin_city.trim() || null,
      region: draft.origin_region.trim() || null,
      geonames_id: original?.origin?.geonames_id ?? null,
      coordinates: original?.origin?.coordinates ?? null,
    },
    occupations: draft.occupations.filter(o => o.label.trim()).map(o => ({ label: o.label.trim() })),
    education: draft.education.filter(e => e.institution.trim()).map(e => ({
      institution: e.institution.trim(),
      ...(e.year.trim() ? { year: parseInt(e.year) } : {}),
    })),
    relations: draft.relations.filter(r => r.name.trim()).map(r => ({
      name: r.name.trim(),
      ...(r.type.trim() ? { type: r.type.trim() } : {}),
    })),
    biography: draft.biography.trim() || null,
    notes: draft.notes.trim() || null,
    identifiers,
    ...(original ? { updated_at: original.updated_at } : {}),
  };
}

// =========================================================
// Kuupäevaväli
// =========================================================
const DateField: React.FC<{
  label: string;
  value: DateDraft;
  onChange: (v: DateDraft) => void;
}> = ({ label, value, onChange }) => {
  const set = (patch: Partial<DateDraft>) => onChange({ ...value, ...patch });

  return (
    <div>
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1000}
          max={1900}
          placeholder="aasta"
          value={value.year}
          onChange={e => set({ year: e.target.value })}
          className="w-24 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
        <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={value.circa}
            onChange={e => set({ circa: e.target.checked })}
            className="accent-primary-600"
          />
          ~
        </label>
        <select
          value={value.bound}
          onChange={e => set({ bound: e.target.value as DateDraft['bound'] })}
          className="text-sm border border-gray-300 rounded px-1.5 py-1.5 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white text-gray-700"
        >
          <option value="">täpne</option>
          <option value="before">enne</option>
          <option value="after">pärast</option>
        </select>
        <input
          type="text"
          placeholder="koht"
          value={value.place}
          onChange={e => set({ place: e.target.value })}
          className="w-32 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
      </div>
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

  // Ligipääsukontroll
  const canEdit = user && (user.role === 'editor' || user.role === 'admin');

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    getPerson(id!, token)
      .then(data => {
        setOriginal(data);
        setDraft(recordToDraft(data));
      })
      .catch(() => setError('Isiku laadimine ebaõnnestus.'))
      .finally(() => setLoading(false));
  }, [id, token]);

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
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
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
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
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

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">

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
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                {t('prosopography.status', 'Seisus')}
              </label>
              <input
                type="text"
                value={draft.status_label}
                onChange={e => set({ status_label: e.target.value })}
                placeholder="aadlik, vaimulik…"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                {t('prosopography.confession', 'Konfessioon')}
              </label>
              <input
                type="text"
                value={draft.confession_label}
                onChange={e => set({ confession_label: e.target.value })}
                placeholder="luterlik, katoliiklik…"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
          </div>

          {/* Päritolu */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                {t('prosopography.origin', 'Päritolu')} — linn
              </label>
              <input
                type="text"
                value={draft.origin_city}
                onChange={e => set({ origin_city: e.target.value })}
                placeholder="Tallinn, Riia…"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                {t('prosopography.origin', 'Päritolu')} — piirkond
              </label>
              <input
                type="text"
                value={draft.origin_region}
                onChange={e => set({ origin_region: e.target.value })}
                placeholder="Liivimaa, Saksimaa…"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
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
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.label}
                  onChange={e => onChange({ label: e.target.value })}
                  placeholder="pastor, jurist, professor…"
                  className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
                <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1">
                  <X size={14} />
                </button>
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
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.institution}
                  onChange={e => onChange({ ...item, institution: e.target.value })}
                  placeholder="Academia Gustaviana, Wittenberg…"
                  className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
                <input
                  type="number"
                  value={item.year}
                  onChange={e => onChange({ ...item, year: e.target.value })}
                  placeholder="aasta"
                  className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
                <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1">
                  <X size={14} />
                </button>
              </div>
            )}
            onAdd={() => set({ education: [...draft.education, { institution: '', year: '' }] })}
            onChange={items => set({ education: items })}
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
                <input
                  type="text"
                  value={item.name}
                  onChange={e => onChange({ ...item, name: e.target.value })}
                  placeholder="Isiku nimi"
                  className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
                <input
                  type="text"
                  value={item.type}
                  onChange={e => onChange({ ...item, type: e.target.value })}
                  placeholder="suhe (abikaasa, isa…)"
                  className="w-40 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
                <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1">
                  <X size={14} />
                </button>
              </div>
            )}
            onAdd={() => set({ relations: [...draft.relations, { name: '', type: '' }] })}
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
