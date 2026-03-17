/**
 * UploadMetaForm — metaandmete vorm upload samm 3-s (OCR ootamise ajal).
 *
 * Laadib hetke meta /admin/upload/{id}/meta GET kaudu, salvestab PATCH kaudu.
 * EntityPicker välju kasutatakse linked data tagamiseks (Wikidata, VIAF, GND).
 */
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Plus, Trash2, X, Loader2, CheckCircle } from 'lucide-react';
import { Creator, CreatorRole } from '../types';
import { LinkedEntity } from '../types/LinkedEntity';
import { Collections, getVocabularies, Vocabularies } from '../services/collectionService';
import EntityPicker, { PeopleRegisterEntry } from './EntityPicker';
import { CollectionDropdown } from './MetadataModal';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getLangCode } from '../utils/getLangCode';
import { getLabel } from '../utils/metadataUtils';

interface UploadMetaFormProps {
  uploadId: string;
  authToken: string;
  collections: Collections;
  /** Algväärtused samm 1-st (kui backend meta pole veel laaditud) */
  initialTitle?: string;
  initialYear?: string;
  initialCollections?: string[];
}

interface MetaForm {
  title: string;
  year: string;
  year_display: string;
  type: string | LinkedEntity | null;
  genre: (string | LinkedEntity)[];
  tags: (string | LinkedEntity)[];
  location: string | LinkedEntity;
  publisher: string | LinkedEntity;
  creators: Creator[];
  languages: string[];
  collections: string[];
  ester_id: string;
  external_url: string;
}

interface SuggestionItem {
  label: string;
  id: string | null;
}

const EMPTY_FORM: MetaForm = {
  title: '',
  year: '',
  year_display: '',
  type: null,
  genre: [],
  tags: [],
  location: '',
  publisher: '',
  creators: [],
  languages: [],
  collections: [],
  ester_id: '',
  external_url: '',
};

const UploadMetaForm: React.FC<UploadMetaFormProps> = ({
  uploadId,
  authToken,
  collections,
  initialTitle = '',
  initialYear = '',
  initialCollections = [],
}) => {
  const { t, i18n } = useTranslation(['upload', 'workspace', 'common']);
  const lang = getLangCode(i18n.language);

  const [form, setForm] = useState<MetaForm>({
    ...EMPTY_FORM,
    title: initialTitle,
    year: initialYear,
    collections: initialCollections,
  });

  const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
  const [peopleRegister, setPeopleRegister] = useState<PeopleRegisterEntry[]>([]);
  const [suggestions, setSuggestions] = useState<{
    authors: SuggestionItem[];
    tags: SuggestionItem[];
    places: SuggestionItem[];
    printers: SuggestionItem[];
    types: SuggestionItem[];
    genres: SuggestionItem[];
  }>({ authors: [], tags: [], places: [], printers: [], types: [], genres: [] });

  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Lae meta backendist + sõnavara + soovitused + isikute register
  useEffect(() => {
    let cancelled = false;

    const loadMeta = async () => {
      try {
        const r = await fetchWithTimeout(
          `${FILE_API_URL}/admin/upload/${uploadId}/meta?token=${authToken}`
        );
        if (!r.ok || cancelled) return;
        const d = await r.json();
        const m = d.meta || {};
        if (!cancelled) {
          setForm({
            title: m.title || initialTitle,
            year: String(m.year || initialYear || ''),
            year_display: m.year_display || '',
            type: m.type_object ?? m.type ?? null,
            genre: (() => {
              const g = m.genre_object ?? m.genre;
              return Array.isArray(g) ? g : g ? [g] : [];
            })(),
            tags: m.tags_object ?? m.tags ?? [],
            location: m.location_object ?? m.location ?? '',
            publisher: m.publisher_object ?? m.publisher ?? '',
            creators: m.creators ?? [],
            languages: m.languages ?? [],
            collections: Array.isArray(m.collections) ? m.collections : initialCollections,
            ester_id: m.ester_id ?? '',
            external_url: m.external_url ?? '',
          });
        }
      } catch {
        // Kasuta algväärtusi
      }
    };

    const loadSuggestions = async () => {
      try {
        const r = await fetchWithTimeout(`${FILE_API_URL}/get-metadata-suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_token: authToken, lang }),
        });
        const d = await r.json();
        if (!cancelled && d.status === 'success') {
          setSuggestions({
            authors: d.authors || [],
            tags: d.tags || [],
            places: d.places || [],
            printers: d.printers || [],
            types: d.types || [],
            genres: d.genres || [],
          });
        }
      } catch {}
    };

    const loadPeopleRegister = async () => {
      try {
        const r = await fetchWithTimeout(`${FILE_API_URL}/people-register`);
        const d = await r.json();
        if (!cancelled && d.status === 'success') setPeopleRegister(d.people || []);
      } catch {}
    };

    getVocabularies().then((v) => { if (!cancelled) setVocabularies(v); }).catch(() => {});
    loadMeta();
    loadSuggestions();
    loadPeopleRegister();

    return () => { cancelled = true; };
  }, [uploadId, authToken]);

  const handleSave = async () => {
    setSaving(true);
    setSaveOk(false);
    setSaveError('');

    const cleanCreators = form.creators
      .filter((c) => c.name.trim() !== '')
      .map((c) => ({ name: c.name.trim(), role: c.role, id: c.id, source: c.source }));

    const cleanTags = form.tags.filter((t) =>
      typeof t === 'string' ? t.trim() !== '' : !!t.label
    );

    let cleanEsterId = form.ester_id.trim();
    const esterMatch = cleanEsterId.match(/record=(b\d+)/);
    if (esterMatch) cleanEsterId = esterMatch[1];

    const payload: Record<string, unknown> = {
      auth_token: authToken,
      title: form.title.trim(),
      year: form.year,
      year_display: form.year_display.trim() || null,
      type: form.type || null,
      genre: form.genre.length > 0 ? form.genre : null,
      tags: cleanTags,
      tags_object: cleanTags,
      location: form.location,
      location_object: form.location,
      publisher: form.publisher,
      publisher_object: form.publisher,
      creators: cleanCreators,
      languages: form.languages,
      collections: form.collections,
      ester_id: cleanEsterId || null,
      external_url: form.external_url.trim() || null,
    };

    try {
      const r = await fetchWithTimeout(
        `${FILE_API_URL}/admin/upload/${uploadId}/meta`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (r.ok) {
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 3000);
      } else {
        setSaveError(t('step3.metaSaveError', 'Salvestamine ebaõnnestus'));
      }
    } catch {
      setSaveError(t('step3.metaSaveError', 'Salvestamine ebaõnnestus'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5 border border-amber-200 rounded-xl bg-amber-50/60 overflow-hidden">
      <div className="px-4 py-3 bg-amber-100/70 border-b border-amber-200">
        <h3 className="text-sm font-semibold text-amber-900">{t('step3.editMetaTitle')}</h3>
        <p className="text-xs text-amber-700 mt-0.5">{t('step3.editMetaNote')}</p>
      </div>

      <div className="p-4 space-y-4">
        {/* Pealkiri */}
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
            {t('step1.titleLabel')}
          </label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white resize-none"
            rows={2}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        {/* Isikud (creators) */}
        <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-white/70">
          <div className="flex justify-between items-center -mt-1">
            <h4 className="text-xs font-bold text-gray-600 uppercase">
              {t('workspace:metadata.creators', 'Isikud')}
            </h4>
            <button
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  creators: [...form.creators, { name: '', role: 'auctor' as CreatorRole }],
                })
              }
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <Plus size={14} />
              {t('workspace:metadata.addCreator', 'Lisa isik')}
            </button>
          </div>
          {form.creators.length === 0 ? (
            <p className="text-xs text-gray-400 italic">
              {t('workspace:metadata.noCreators', 'Isikuid pole lisatud')}
            </p>
          ) : (
            <div className="space-y-2">
              {form.creators.map((creator, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <EntityPicker
                      type="person"
                      value={
                        creator.id || creator.source === 'wikidata'
                          ? {
                              id: creator.id || null,
                              label: creator.name,
                              source: creator.source || 'wikidata',
                              labels: { et: creator.name },
                            }
                          : creator.name
                      }
                      onChange={(val) => {
                        const next = [...form.creators];
                        next[i] = {
                          ...creator,
                          name: val?.label || '',
                          id: val?.id || null,
                          source: (val?.source === 'local' ? 'manual' : val?.source) || 'manual',
                        };
                        setForm({ ...form, creators: next });
                      }}
                      placeholder={t('workspace:metadata.creatorName', 'Nimi')}
                      lang={lang}
                      localSuggestions={suggestions.authors}
                      peopleRegister={peopleRegister}
                    />
                  </div>
                  <select
                    className="border border-gray-300 rounded px-2 py-[7px] text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white w-36"
                    value={creator.role}
                    onChange={(e) => {
                      const next = [...form.creators];
                      next[i] = { ...creator, role: e.target.value as CreatorRole };
                      setForm({ ...form, creators: next });
                    }}
                  >
                    {vocabularies
                      ? Object.entries(vocabularies.roles).map(([roleId, roleData]) => (
                          <option key={roleId} value={roleId}>
                            {roleData[lang] || roleData.et}
                          </option>
                        ))
                      : (
                        <>
                          <option value="praeses">Praeses</option>
                          <option value="respondens">Respondens</option>
                          <option value="auctor">Autor</option>
                        </>
                      )}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, creators: form.creators.filter((_, j) => j !== i) })
                    }
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title={t('workspace:metadata.removeCreator', 'Eemalda')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Kolofoon: aasta, koht, trükkal */}
        <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-white/70">
          <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">
            {t('workspace:metadata.colophon', 'Kolofoon')}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('workspace:metadata.year')}
              </label>
              <input
                type="number"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                value={form.year}
                min={1200}
                max={1800}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('workspace:metadata.yearDisplay')}
              </label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                placeholder={t('workspace:metadata.yearDisplayPlaceholder', 'nt ca. 1680')}
                value={form.year_display}
                onChange={(e) => setForm({ ...form, year_display: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <EntityPicker
              label={t('workspace:metadata.place')}
              type="place"
              value={form.location}
              onChange={(val) => setForm({ ...form, location: val || '' })}
              lang={lang}
              localSuggestions={suggestions.places}
            />
            <EntityPicker
              label={t('workspace:metadata.printer')}
              type="printer"
              value={form.publisher}
              onChange={(val) => setForm({ ...form, publisher: val || '' })}
              lang={lang}
              localSuggestions={suggestions.printers}
              peopleRegister={peopleRegister}
            />
          </div>
        </div>

        {/* Klassifikatsioon: kollektsioon, žanr, tüüp, keeled, tägid */}
        <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-white/70">
          <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">
            {t('workspace:metadata.classification', 'Klassifikatsioon')}
          </h4>
          <CollectionDropdown
            collections={collections}
            selected={form.collections}
            lang={lang}
            onChange={(next) => setForm({ ...form, collections: next })}
            label={t('workspace:metadata.collection')}
          />
          {/* Žanrid */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              {t('workspace:metadata.genre', 'Žanr')}
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {form.genre.length === 0 && (
                <span className="text-xs text-gray-400 italic">
                  {t('workspace:metadata.noGenres', 'Žanrid puuduvad')}
                </span>
              )}
              {form.genre.map((g, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border ${
                    typeof g !== 'string' && (g as LinkedEntity).id
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-gray-100 border-gray-200 text-gray-700'
                  }`}
                >
                  {getLabel(g, lang)}
                  <button
                    onClick={() =>
                      setForm({ ...form, genre: form.genre.filter((_, j) => j !== i) })
                    }
                    className="hover:text-red-500"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <EntityPicker
              type="genre"
              value={null}
              alreadySelected={form.genre.filter((g) => typeof g !== 'string') as LinkedEntity[]}
              onChange={(val) => {
                if (!val) return;
                if (val.id) {
                  const idx = form.genre.findIndex(
                    (g) => typeof g !== 'string' && (g as LinkedEntity).id === val.id
                  );
                  if (idx !== -1) {
                    const next = [...form.genre];
                    next[idx] = { ...(next[idx] as LinkedEntity), labels: { ...(next[idx] as LinkedEntity).labels, ...val.labels } };
                    setForm({ ...form, genre: next });
                    return;
                  }
                }
                setForm({ ...form, genre: [...form.genre, val] });
              }}
              placeholder={t('workspace:metadata.genrePlaceholder', 'Lisa žanr...')}
              lang={lang}
              localSuggestions={suggestions.genres}
            />
          </div>
          {/* Tüüp */}
          <div className="w-1/2">
            <EntityPicker
              label={t('workspace:metadata.type', 'Tüüp')}
              type="topic"
              value={form.type}
              onChange={(val) => setForm({ ...form, type: val })}
              placeholder="nt: trükis, käsikiri"
              lang={lang}
              localSuggestions={suggestions.types}
            />
          </div>
          {/* Keeled */}
          {vocabularies && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('workspace:metadata.languages', 'Keeled')}
              </label>
              <div className="flex flex-wrap gap-3">
                {Object.entries(vocabularies.languages).map(([langId, langData]) => (
                  <label key={langId} className="inline-flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.languages.includes(langId)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...form.languages, langId]
                          : form.languages.filter((l) => l !== langId);
                        setForm({ ...form, languages: next });
                      }}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-gray-700">{langData[lang] || langData.et}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {/* Tägid */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              {t('workspace:metadata.tags')}
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {form.tags.length === 0 && (
                <span className="text-xs text-gray-400 italic">Märksõnad puuduvad</span>
              )}
              {form.tags.map((tag, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border ${
                    typeof tag !== 'string' && tag.id
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-gray-100 border-gray-200 text-gray-700'
                  }`}
                >
                  {getLabel(tag, lang)}
                  <button
                    onClick={() =>
                      setForm({ ...form, tags: form.tags.filter((_, j) => j !== i) })
                    }
                    className="hover:text-red-500"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <EntityPicker
              type="topic"
              value={null}
              alreadySelected={form.tags.filter((t) => typeof t !== 'string') as LinkedEntity[]}
              onChange={(val) => {
                if (!val) return;
                if (val.id) {
                  const idx = form.tags.findIndex(
                    (t) => typeof t !== 'string' && (t as LinkedEntity).id === val.id
                  );
                  if (idx !== -1) {
                    const next = [...form.tags];
                    next[idx] = { ...(next[idx] as LinkedEntity), labels: { ...(next[idx] as LinkedEntity).labels, ...val.labels } };
                    setForm({ ...form, tags: next });
                    return;
                  }
                }
                setForm({ ...form, tags: [...form.tags, val] });
              }}
              placeholder={t('workspace:metadata.tagsPlaceholder', 'Lisa märksõna...')}
              lang={lang}
              localSuggestions={suggestions.tags}
            />
          </div>
        </div>

        {/* Välised lingid */}
        <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-white/70">
          <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">
            {t('workspace:metadata.externalLinks', 'Välised lingid')}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('workspace:metadata.esterId')}
              </label>
              <input
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                value={form.ester_id}
                onChange={(e) => setForm({ ...form, ester_id: e.target.value })}
                placeholder="nt: b1234567"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t('workspace:metadata.externalUrl')}
              </label>
              <input
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                value={form.external_url}
                onChange={(e) => setForm({ ...form, external_url: e.target.value })}
                placeholder="https://..."
              />
            </div>
          </div>
        </div>

        {/* Salvestusnupp */}
        {saveError && (
          <p className="text-xs text-red-600">{saveError}</p>
        )}
        <button
          onClick={handleSave}
          disabled={saving || !form.title.trim()}
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
        >
          {saving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : saveOk ? (
            <CheckCircle size={15} />
          ) : (
            <Save size={15} />
          )}
          {saveOk ? t('step3.metaSaved') : t('step3.metaSaveBtn')}
        </button>
      </div>
    </div>
  );
};

export default UploadMetaForm;
