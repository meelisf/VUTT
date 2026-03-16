import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Save, X, Loader2, ImagePlus, Trash2, ExternalLink } from 'lucide-react';
import Header from '../../components/Header';
import EntityPicker from '../../components/EntityPicker';
import { FILE_API_URL } from '../../config';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import { getPerson, createPerson, updatePerson, uploadPersonImage, deletePersonImage } from '../services/prosopographyService';
import { useUser } from '../../contexts/UserContext';
import type { ProsopoRecord } from '../types';

import { type FormDraft, type DateDraft, type OccupationDraft, type EducationDraft, emptyDraft } from '../components/personForm/types';
import { recordToDraft, draftToPayload } from '../components/personForm/helpers';
import DateField from '../components/personForm/DateField';
import AliasesList from '../components/personForm/AliasesList';
import ProsopoPersonPicker from '../components/personForm/ProsopoPersonPicker';
import TagsList from '../components/personForm/TagsList';
import { CollapsibleSection, DynamicList } from '../components/personForm/CollapsibleSection';
import EnrichmentSearch from '../components/personForm/EnrichmentSearch';
import EnrichExistingSection from '../components/personForm/EnrichExistingSection';

const PersonEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation(['common']);
  const { user, authToken } = useUser();

  const isNew = !id || id === 'new';
  const token = authToken ?? '';

  const prefillName = isNew ? (searchParams.get('name') ?? '') : '';

  const [original, setOriginal] = useState<ProsopoRecord | null>(null);
  const [draft, setDraft] = useState<FormDraft>(() => {
    const d = emptyDraft();
    if (prefillName) d.name_label = prefillName;
    return d;
  });
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrichedWith, setEnrichedWith] = useState<{ scheme: string; id: string; label: string; fields: string[] } | null>(null);
  const [namesOpen, setNamesOpen] = useState(false);
  const [occupOpen, setOccupOpen] = useState(false);
  const [relOpen, setRelOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // labels.json kohalikud soovitused topic-tüüpi EntityPickeritele
  const [entityLabels, setEntityLabels] = useState<{ label: string; id: string }[]>([]);
  const lang = 'et';

  // Profiilipilt
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageDragOver, setImageDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canEdit = user && (user.role === 'editor' || user.role === 'admin');

  useEffect(() => {
    fetchWithTimeout(`${FILE_API_URL}/entity-labels`)
      .then(r => r.json())
      .then((data: Record<string, { et?: string; en?: string }>) => {
        const items = Object.entries(data)
          .filter(([, v]) => v.et || v.en)
          .map(([id, v]) => ({ id, label: v.et || v.en! }));
        setEntityLabels(items);
      })
      .catch(() => {});
  }, []);

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
    if (!file.type.startsWith('image/')) { setImageError('Palun vali pildifail (JPEG, PNG, WebP).'); return; }
    if (file.size > 10 * 1024 * 1024) { setImageError('Fail on liiga suur (max 10 MB).'); return; }
    if (isNew) { setImageError('Salvesta isik esmalt, seejärel lisa pilt.'); return; }
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

  const handleSave = async () => {
    if (!draft.name_label.trim()) { setError('Nimi on kohustuslik.'); return; }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const created = await createPerson(
          {
            name: draft.name_label.trim(),
            birth_year: draft.birth.year ? parseInt(draft.birth.year) : undefined,
            death_year: draft.death.year ? parseInt(draft.death.year) : undefined,
            notes: draft.notes.trim() || undefined,
          },
          token,
        );
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

  const inputCls = "px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none";

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

        {/* ── Rikastamine välisallikatest (ainult uus isik) ── */}
        {isNew && !enrichedWith && (
          <EnrichmentSearch
            draft={draft}
            token={token}
            onEnrich={(newDraft, info) => {
              setDraft(newDraft);
              setEnrichedWith(info);
              setNamesOpen(true); // ava identifikaatorid
            }}
          />
        )}

        {enrichedWith && (
          <div className="mb-5 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800 flex items-start gap-2">
            <span className="shrink-0 mt-0.5">✓</span>
            <span className="flex-1">
              <strong>Rikastatud {enrichedWith.scheme === 'wikidata' ? 'Wikidatast' : enrichedWith.scheme === 'gnd' ? 'GND-st' : enrichedWith.scheme === 'album_academicum' ? 'Album Academicumist' : 'VIAF-ist'}</strong>
              {' '}({enrichedWith.id})
              {enrichedWith.fields.length > 0 && (
                <span className="text-green-700"> — täideti: {enrichedWith.fields.join(', ')}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setEnrichedWith(null)}
              className="text-green-400 hover:text-green-700 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── Profiilipilt ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-3">Profiilipilt</label>
          <div className="flex items-start gap-4">
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
                <img src={imageUrl} alt="Profiilipilt" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus size={24} className="text-gray-300" />
              )}
              {imageUploading && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                  <Loader2 size={18} className="animate-spin text-primary-500" />
                </div>
              )}
            </div>

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
              className={`w-full ${inputCls}`}
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
                className={`w-full ${inputCls}`}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Täiend (qualifier)</label>
              <input
                type="text"
                value={draft.name_qualifier}
                onChange={e => set({ name_qualifier: e.target.value })}
                placeholder="von, van, de…"
                className={`w-full ${inputCls}`}
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
              lang={lang}
              localSuggestions={entityLabels}
            />
            <EntityPicker
              label={t('prosopography.confession', 'Konfessioon')}
              placeholder="luterlik, katoliiklik…"
              type="topic"
              value={draft.confession}
              onChange={v => set({ confession: v })}
              lang={lang}
              localSuggestions={entityLabels}
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

          {/* Floruit */}
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
                className={`w-20 ${inputCls}`}
              />
              <span className="text-gray-400">–</span>
              <input
                type="number" min={1000} max={1900}
                placeholder="kuni"
                value={draft.floruit_to}
                onChange={e => set({ floruit_to: e.target.value })}
                className={`w-20 ${inputCls}`}
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
                { key: 'wikidata_id', label: 'Wikidata', placeholder: 'Q12345', url: (v: string) => `https://www.wikidata.org/wiki/${v}` },
                { key: 'gnd_id', label: 'GND', placeholder: '123456789', url: (v: string) => `https://d-nb.info/gnd/${v}` },
                { key: 'viaf_id', label: 'VIAF', placeholder: '12345678', url: (v: string) => `https://viaf.org/viaf/${v}` },
                { key: 'aa_id', label: 'Album Academicum', placeholder: 'AA-123', url: null },
              ].map(({ key, label, placeholder, url }) => {
                const val = draft[key as keyof FormDraft] as string;
                const href = url && val.trim() ? url(val.trim()) : null;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-36 shrink-0">{label}</span>
                    <input
                      type="text"
                      value={val}
                      onChange={e => set({ [key]: e.target.value } as Partial<FormDraft>)}
                      placeholder={placeholder}
                      className={`flex-1 ${inputCls} font-mono`}
                    />
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer"
                        className="text-gray-400 hover:text-blue-600 transition-colors shrink-0"
                        title={`Ava ${label}-s`}>
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      <span className="w-[14px] shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {!isNew && (
            <EnrichExistingSection
              personId={id!}
              wikidataId={draft.wikidata_id}
              gndId={draft.gnd_id}
              aaId={draft.aa_id}
              draft={draft}
              token={token}
              onChange={newDraft => setDraft(newDraft)}
              onApplied={fields => {
                if (fields.some(f => f === '_occupations' || f === '_occupation_label')) setOccupOpen(true);
              }}
            />
          )}
        </CollapsibleSection>

        {/* ── Ametid ja haridus (klapitav) ── */}
        <CollapsibleSection
          title={`${t('prosopography.occupations', 'Ametid')} ja ${t('prosopography.education', 'haridus').toLowerCase()}`}
          open={occupOpen}
          onToggle={() => setOccupOpen(v => !v)}
        >
          <DynamicList
            label={t('prosopography.occupations', 'Ametid')}
            items={draft.occupations}
            renderItem={(item: OccupationDraft, onChange, onRemove) => (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-0.5">Amet</label>
                    <EntityPicker
                      placeholder="pastor, jurist, professor…"
                      type="topic"
                      value={item.id ? { label: item.label, id: item.id, labels: item.labels, source: 'wikidata' } : (item.label ? { label: item.label, id: null, labels: null, source: 'manual' } : null)}
                      onChange={v => onChange({ ...item, label: v?.label ?? '', id: v?.id ?? null, labels: v?.labels ?? undefined })}
                      lang={lang}
                      localSuggestions={entityLabels}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-0.5">Asutus / töökoht</label>
                    <EntityPicker
                      placeholder="Academia Gustaviana…"
                      type="topic"
                      value={item.institution_id ? { label: item.institution ?? '', id: item.institution_id, labels: item.institution_labels, source: 'wikidata' } : (item.institution ? { label: item.institution, id: null, labels: null, source: 'manual' } : null)}
                      onChange={v => onChange({ ...item, institution: v?.label ?? '', institution_id: v?.id ?? null, institution_labels: v?.labels ?? undefined })}
                      lang={lang}
                      localSuggestions={entityLabels}
                    />
                  </div>
                  <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0 mt-5">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-gray-400 shrink-0">Periood</span>
                  <input type="number" min={1000} max={1900} value={item.year_from ?? ''} onChange={e => onChange({ ...item, year_from: e.target.value })} placeholder="alates" className={`w-20 ${inputCls}`} />
                  <span className="text-gray-400">–</span>
                  <input type="number" min={1000} max={1900} value={item.year_to ?? ''} onChange={e => onChange({ ...item, year_to: e.target.value })} placeholder="kuni" className={`w-20 ${inputCls}`} />
                </div>
              </div>
            )}
            onAdd={() => set({ occupations: [...draft.occupations, { label: '' }] })}
            onChange={items => set({ occupations: items })}
          />

          <DynamicList
            label={t('prosopography.education', 'Haridus')}
            items={draft.education}
            renderItem={(item: EducationDraft, onChange, onRemove) => (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-0.5">Asutus</label>
                    <EntityPicker
                      placeholder="Academia Gustaviana, Wittenberg…"
                      type="topic"
                      value={item.institution_id ? { label: item.institution, id: item.institution_id, labels: item.institution_labels ?? null, source: 'wikidata' } : (item.institution ? { label: item.institution, id: null, labels: null, source: 'manual' } : null)}
                      onChange={v => onChange({ ...item, institution: v?.label ?? '', institution_id: v?.id ?? null, institution_labels: v?.labels ?? undefined })}
                      lang={lang}
                      localSuggestions={entityLabels}
                    />
                  </div>
                  <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0 mt-5">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 shrink-0">Periood</span>
                  <input type="number" min={1000} max={1900} value={item.year_from ?? ''} onChange={e => onChange({ ...item, year_from: e.target.value })} placeholder="alates" className={`w-20 ${inputCls}`} />
                  <span className="text-gray-400">–</span>
                  <input type="number" min={1000} max={1900} value={item.year_to ?? ''} onChange={e => onChange({ ...item, year_to: e.target.value })} placeholder="kuni" className={`w-20 ${inputCls}`} />
                </div>
              </div>
            )}
            onAdd={() => set({ education: [...draft.education, { institution: '' }] })}
            onChange={items => set({ education: items })}
          />

          <TagsList tags={draft.tags} onChange={v => set({ tags: v })} />
        </CollapsibleSection>

        {/* ── Seosed ja märkmed (klapitav) ── */}
        <CollapsibleSection
          title={`${t('prosopography.relations', 'Seosed')} ja ${t('prosopography.notes', 'märkmed').toLowerCase()}`}
          open={relOpen}
          onToggle={() => setRelOpen(v => !v)}
        >
          <DynamicList
            label={t('prosopography.relations', 'Seosed')}
            items={draft.relations}
            renderItem={(item, onChange, onRemove) => (
              <div className="flex items-center gap-2">
                <ProsopoPersonPicker value={item} onChange={onChange} token={token} currentId={id} />
                <input
                  type="text"
                  value={item.type}
                  onChange={e => onChange({ ...item, type: e.target.value })}
                  placeholder="suhe (abikaasa, isa…)"
                  className={`w-36 ${inputCls} shrink-0`}
                />
                <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0">
                  <X size={14} />
                </button>
              </div>
            )}
            onAdd={() => set({ relations: [...draft.relations, { name: '', type: '', target_id: null }] })}
            onChange={items => set({ relations: items })}
          />

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
                      className={`w-full ${inputCls}`}
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
                  className={`w-full ${inputCls} bg-white text-gray-600 italic`}
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
