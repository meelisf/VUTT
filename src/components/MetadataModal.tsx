import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit3, X, Save, Plus, Trash2, Library } from 'lucide-react';
import { getVocabularies, Vocabularies, Collections } from '../services/collectionService';
import { Creator, CreatorRole, Page, Work } from '../types';
import { LinkedEntity } from '../types/LinkedEntity';
import { getLabel } from '../utils/metadataUtils';
import EntityPicker from './EntityPicker';
import { FILE_API_URL } from '../config';

interface MetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  page: Page;
  work?: Work;
  workId: string;
  authToken: string;
  collections: Collections;
  onSaveSuccess: (updatedPage: Partial<Page>, updatedWork: Partial<Work>) => void;
}

interface MetadataForm {
  title: string;
  year: number;
  type: string | null;
  genre: string | LinkedEntity | LinkedEntity[] | null;
  tags: (string | LinkedEntity)[];
  location: string | LinkedEntity;
  publisher: string | LinkedEntity;
  creators: Creator[];
  languages: string[];
  ester_id: string;
  external_url: string;
  collection: string | null;
}

interface SuggestionItem {
  label: string;
  id: string | null;
}

const MetadataModal: React.FC<MetadataModalProps> = ({
  isOpen,
  onClose,
  page,
  work,
  workId,
  authToken,
  collections,
  onSaveSuccess
}) => {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const lang = (i18n.language as 'et' | 'en') || 'et';

  const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
  const [metaForm, setMetaForm] = useState<MetadataForm>({
    title: '',
    year: 0,
    type: null,
    genre: null,
    tags: [],
    location: '',
    publisher: '',
    creators: [],
    languages: [],
    ester_id: '',
    external_url: '',
    collection: null
  });
  const [suggestions, setSuggestions] = useState<{
    authors: SuggestionItem[];
    tags: SuggestionItem[];
    places: SuggestionItem[];
    printers: SuggestionItem[];
    types: SuggestionItem[];
    genres: SuggestionItem[];
  }>({ authors: [], tags: [], places: [], printers: [], types: [], genres: [] });
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Lae andmed kui modal avatakse
  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    // Ehita creators massiiv olemasolevatest andmetest
    const initialCreators: Creator[] = [];
    if (work?.author || page.autor) {
      initialCreators.push({ name: work?.author || page.autor || '', role: 'praeses' });
    }
    if (work?.respondens || page.respondens) {
      initialCreators.push({ name: work?.respondens || page.respondens || '', role: 'respondens' });
    }

    // Algväärtused page/work objektidest
    setMetaForm({
      title: work?.title || page.title || page.pealkiri || '',
      year: work?.year || page.year || page.aasta || 0,
      type: work?.type || page.type || null,
      genre: work?.genre || page.genre || null,
      tags: work?.tags || page.tags || [],
      location: work?.location || work?.koht || page.location || page.koht || '',
      publisher: work?.publisher || work?.trükkal || page.publisher || page.trükkal || '',
      creators: work?.creators || page.creators || initialCreators,
      languages: work?.languages || page.languages || [],
      ester_id: work?.ester_id || page.ester_id || '',
      external_url: work?.external_url || page.external_url || '',
      collection: work?.collection || page.collection || null
    });

    // Lae sõnavara
    const vocabs = await getVocabularies();
    setVocabularies(vocabs);

    // Lae soovitused
    fetchSuggestions();

    // Lae serverist värskeim metadata
    await fetchServerMetadata();
  };

  const fetchSuggestions = async () => {
    try {
      const response = await fetch(`${FILE_API_URL}/get-metadata-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: authToken })
      });
      const data = await response.json();
      if (data.status === 'success') {
        // Server tagastab nüüd [{label: "...", id: "..."}, ...]
        setSuggestions({
          authors: data.authors || [],
          tags: data.tags || [],
          places: data.places || [],
          printers: data.printers || [],
          types: data.types || [],
          genres: data.genres || []
        });
      }
    } catch (e) {
      console.error("Viga soovituste laadimisel", e);
    }
  };

  const fetchServerMetadata = async () => {
    let payload: any = { auth_token: authToken, work_id: workId };
    if (page.originaal_kataloog) {
      payload.original_path = page.originaal_kataloog;
    }

    try {
      const response = await fetch(`${FILE_API_URL}/get-work-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data.status === 'success' && data.metadata) {
        const m = data.metadata;

        // V2 formaat (v1 fallback turvavõrguna)
        const title = m.title ?? m.pealkiri ?? '';
        const year = m.year ?? m.aasta ?? 0;
        const location = m.location ?? m.koht ?? '';
        const publisher = m.publisher ?? m.trükkal ?? '';
        const tags = m.tags ?? m.teose_tags ?? [];

        // Creators: v2 esmalt, v1 fallback
        let creators: Creator[] = [];
        if (Array.isArray(m.creators) && m.creators.length > 0) {
          creators = m.creators;
        } else {
          if (m.autor) creators.push({ name: m.autor, role: 'praeses' });
          if (m.respondens) creators.push({ name: m.respondens, role: 'respondens' });
        }

        setMetaForm({
          title: title,
          year: year ? parseInt(year) : 0,
          type: m.type || null,
          genre: m.genre || null,
          tags: Array.isArray(tags) ? tags : [],
          location: location || '',
          publisher: publisher || '',
          creators: creators,
          languages: m.languages || [],
          ester_id: m.ester_id || '',
          external_url: m.external_url || '',
          collection: m.collection || null
        });
      }
    } catch (e) {
      console.error("Viga metaandmete laadimisel failiserverist:", e);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');

    try {
      // Puhasta märksõnad (eemalda tühjad stringid)
      const tagsArray = metaForm.tags
        .filter(t => {
          if (typeof t === 'string') return t.trim() !== '';
          return !!t.label;
        })
        .map(t => {
          if (typeof t === 'string') return t.trim();
          return t;
        });

      // ESTER ID puhastamine
      let cleanEsterId = metaForm.ester_id.trim();
      const esterMatch = cleanEsterId.match(/record=(b\d+)/);
      if (esterMatch) {
        cleanEsterId = esterMatch[1];
      }

      // Puhasta creators massiiv
      const cleanCreators = metaForm.creators
        .filter(c => c.name.trim() !== '')
        .map(c => ({ 
          name: c.name.trim(), 
          role: c.role,
          id: c.id,
          source: c.source 
        }));

      // V2/V3 formaat
      let payload: any = {
        auth_token: authToken,
        work_id: workId,
        metadata: {
          title: metaForm.title,
          year: metaForm.year,
          type: metaForm.type || null,
          genre: metaForm.genre || null,
          creators: cleanCreators,
          tags: tagsArray,
          languages: metaForm.languages.length > 0 ? metaForm.languages : null,
          location: metaForm.location,
          publisher: metaForm.publisher,
          ester_id: cleanEsterId || null,
          external_url: metaForm.external_url.trim() || null,
          collection: metaForm.collection
        }
      };

      if (page.originaal_kataloog) {
        payload.original_path = page.originaal_kataloog;
      }

      const response = await fetch(`${FILE_API_URL}/update-work-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.status === 'success') {
        const praeses = cleanCreators.find(c => c.role === 'praeses');
        const respondens = cleanCreators.find(c => c.role === 'respondens');

        const locationLabel = typeof metaForm.location === 'string' ? metaForm.location : metaForm.location.label;
        const publisherLabel = typeof metaForm.publisher === 'string' ? metaForm.publisher : metaForm.publisher.label;

        // Teata parent komponendile uuendatud andmetest
        onSaveSuccess(
          {
            title: metaForm.title,
            pealkiri: metaForm.title,
            year: metaForm.year,
            aasta: metaForm.year,
            type: metaForm.type || undefined,
            genre: metaForm.genre || undefined,
            creators: cleanCreators,
            autor: praeses?.name,
            respondens: respondens?.name,
            tags: tagsArray,
            languages: metaForm.languages,
            location: metaForm.location,
            koht: locationLabel,
            publisher: metaForm.publisher,
            trükkal: publisherLabel,
            ester_id: cleanEsterId || undefined,
            external_url: metaForm.external_url.trim() || undefined,
            collection: metaForm.collection
          },
          {
            title: metaForm.title,
            year: metaForm.year,
            type: metaForm.type || undefined,
            genre: metaForm.genre || undefined,
            creators: cleanCreators,
            author: praeses?.name,
            respondens: respondens?.name,
            tags: tagsArray,
            languages: metaForm.languages,
            location: metaForm.location,
            koht: locationLabel,
            publisher: metaForm.publisher,
            trükkal: publisherLabel,
            ester_id: cleanEsterId || undefined,
            external_url: metaForm.external_url.trim() || undefined,
            collection: metaForm.collection
          }
        );

        setSaveStatus('success');
        setTimeout(() => {
          onClose();
          setSaveStatus('idle');
        }, 1500);
      } else {
        setSaveStatus('error');
        alert('Viga salvestamisel: ' + data.message);
      }
    } catch (e) {
      console.error("Metadata save failed", e);
      setSaveStatus('error');
      alert('Serveri viga andmete salvestamisel.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Edit3 size={18} className="text-amber-600" />
            {t('metadata.title')}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Pealkiri */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{t('metadata.workTitle')}</label>
            <textarea
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              rows={2}
              value={metaForm.title}
              onChange={e => setMetaForm({ ...metaForm, title: e.target.value })}
            />
          </div>

          {/* Grupp 1: Isikud (creators) */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
            <div className="flex justify-between items-center -mt-1">
              <h4 className="text-xs font-bold text-gray-600 uppercase">{t('metadata.creators', 'Isikud')}</h4>
              <button
                type="button"
                onClick={() => setMetaForm({
                  ...metaForm,
                  creators: [...metaForm.creators, { name: '', role: 'praeses' as CreatorRole }]
                })}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                <Plus size={14} />
                {t('metadata.addCreator', 'Lisa isik')}
              </button>
            </div>
            {metaForm.creators.length === 0 ? (
              <p className="text-xs text-gray-400 italic">{t('metadata.noCreators', 'Isikuid pole lisatud')}</p>
            ) : (
              <div className="space-y-2">
                {metaForm.creators.map((creator, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <div className="flex-1">
                      <EntityPicker
                        type="person"
                        value={creator.id || creator.source === 'wikidata' ? {
                          id: creator.id || null,
                          label: creator.name,
                          source: creator.source || 'wikidata',
                          labels: { et: creator.name }
                        } : creator.name}
                        onChange={(val) => {
                          const newCreators = [...metaForm.creators];
                          newCreators[index] = { 
                            ...creator, 
                            name: val?.label || '',
                            id: val?.id || null,
                            source: val?.source || 'manual'
                          };
                          setMetaForm({ ...metaForm, creators: newCreators });
                        }}
                        placeholder={t('metadata.creatorName', 'Nimi')}
                        lang={lang}
                        localSuggestions={suggestions.authors}
                      />
                    </div>
                    <select
                      className="border border-gray-300 rounded px-2 py-[7px] text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white w-36"
                      value={creator.role}
                      onChange={e => {
                        const newCreators = [...metaForm.creators];
                        newCreators[index] = { ...creator, role: e.target.value as CreatorRole };
                        setMetaForm({ ...metaForm, creators: newCreators });
                      }}
                    >
                      {vocabularies && Object.entries(vocabularies.roles).map(([roleId, roleData]) => (
                        <option key={roleId} value={roleId}>
                          {roleData[lang] || roleData.et}
                        </option>
                      ))}
                      {!vocabularies && (
                        <>
                          <option value="praeses">Praeses</option>
                          <option value="respondens">Respondens</option>
                          <option value="auctor">Autor</option>
                        </>
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const newCreators = metaForm.creators.filter((_, i) => i !== index);
                        setMetaForm({ ...metaForm, creators: newCreators });
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                      title={t('metadata.removeCreator', 'Eemalda')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Grupp 2: Bibliograafilised andmed */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
            <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">{t('metadata.bibliographic', 'Bibliograafilised andmed')}</h4>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('metadata.year')}</label>
                <input
                  type="number"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                  value={metaForm.year || ''}
                  onChange={e => setMetaForm({ ...metaForm, year: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <EntityPicker
                  label={t('metadata.place')}
                  type="place"
                  value={metaForm.location}
                  onChange={val => setMetaForm({ ...metaForm, location: val || '' })}
                  lang={lang}
                  localSuggestions={suggestions.places}
                />
              </div>
              <div className="col-span-2">
                <EntityPicker
                  label={t('metadata.printer')}
                  type="printer"
                  value={metaForm.publisher}
                  onChange={val => setMetaForm({ ...metaForm, publisher: val || '' })}
                  lang={lang}
                  localSuggestions={suggestions.printers}
                />
              </div>
            </div>
          </div>

          {/* Grupp 3: Klassifikatsioon */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
            <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">{t('metadata.classification', 'Klassifikatsioon')}</h4>
            <div className="grid grid-cols-3 gap-3">
              {/* Tüüp */}
              <div>
                <EntityPicker
                  label={t('metadata.type', 'Tüüp')}
                  type="topic"
                  value={metaForm.type}
                  onChange={val => setMetaForm({ ...metaForm, type: val })}
                  placeholder="nt: trükis, käsikiri"
                  lang={lang}
                  localSuggestions={suggestions.types}
                />
              </div>
              {/* Žanr */}
              <div>
                <EntityPicker
                  label={t('metadata.genre', 'Žanr')}
                  type="genre"
                  value={metaForm.genre}
                  onChange={val => setMetaForm({ ...metaForm, genre: val })}
                  placeholder="nt: disputatsioon, oratsioon"
                  lang={lang}
                  localSuggestions={suggestions.genres}
                />
              </div>
              {/* Kollektsioon */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                  <Library size={12} />
                  {t('metadata.collection')}
                </label>
                <select
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                  value={metaForm.collection || ''}
                  onChange={e => setMetaForm({ ...metaForm, collection: e.target.value || null })}
                >
                  <option value="">{t('metadata.noCollection')}</option>
                  {Object.entries(collections).map(([id, col]) => (
                    <option key={id} value={id}>
                      {col.name[lang] || col.name.et}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* Keeled */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('metadata.languages', 'Keeled')}</label>
              <div className="flex flex-wrap gap-2">
                {vocabularies && Object.entries(vocabularies.languages).map(([langId, langData]) => (
                  <label key={langId} className="inline-flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={metaForm.languages.includes(langId)}
                      onChange={e => {
                        if (e.target.checked) {
                          setMetaForm({ ...metaForm, languages: [...metaForm.languages, langId] });
                        } else {
                          setMetaForm({ ...metaForm, languages: metaForm.languages.filter(l => l !== langId) });
                        }
                      }}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-gray-700">{langData[lang] || langData.et}</span>
                  </label>
                ))}
              </div>
            </div>
            {/* Tagid */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">{t('metadata.tags')}</label>
              
              <div className="flex flex-wrap gap-2 mb-3">
                {metaForm.tags.length === 0 && <span className="text-xs text-gray-400 italic">Märksõnad puuduvad</span>}
                {metaForm.tags.map((tag, idx) => (
                  <span key={idx} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border ${
                    typeof tag !== 'string' && tag.id ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-100 border-gray-200 text-gray-700'
                  }`}>
                    {getLabel(tag, lang)}
                    <button 
                      onClick={() => setMetaForm({ ...metaForm, tags: metaForm.tags.filter((_, i) => i !== idx) })}
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
                onChange={val => {
                  if (val) {
                    setMetaForm({ ...metaForm, tags: [...metaForm.tags, val] });
                  }
                }}
                placeholder={t('metadata.tagsPlaceholder', 'Lisa märksõna...')}
                lang={lang}
                localSuggestions={suggestions.tags}
              />
              <p className="text-[10px] text-gray-400 mt-1 italic">
                {t('metadata.tagsHint')}
              </p>
            </div>
          </div>

          {/* Grupp 4: Välised lingid */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
            <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">{t('metadata.externalLinks', 'Välised lingid')}</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('metadata.esterId')}</label>
                <input
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                  value={metaForm.ester_id}
                  onChange={e => setMetaForm({ ...metaForm, ester_id: e.target.value })}
                  placeholder="nt: b1234567"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('metadata.externalUrl')}</label>
                <input
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                  value={metaForm.external_url}
                  onChange={e => setMetaForm({ ...metaForm, external_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>
            </div>
          </div>

          {/* Soovituste nimekirjad */}
          <datalist id="tag-suggestions">
            {suggestions.tags.map((t, i) => <option key={i} value={t.label} />)}
          </datalist>
          <datalist id="author-suggestions">
            {suggestions.authors.map((a, i) => <option key={i} value={a.label} />)}
          </datalist>
          <datalist id="place-suggestions">
            {suggestions.places.map((p, i) => <option key={i} value={p.label} />)}
          </datalist>
          <datalist id="printer-suggestions">
            {suggestions.printers.map((p, i) => <option key={i} value={p.label} />)}
          </datalist>
        </div>
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
          >
            {t('common:buttons.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`px-4 py-2 rounded text-sm font-medium flex items-center gap-2 transition-all min-w-[120px] justify-center ${saveStatus === 'success'
              ? 'bg-green-600 text-white'
              : saveStatus === 'error'
                ? 'bg-red-600 text-white'
                : 'bg-amber-600 text-white hover:bg-amber-700'
              } disabled:opacity-70`}
          >
            {isSaving ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
            ) : saveStatus === 'success' ? (
              <>{t('metadata.saveSuccess')}</>
            ) : saveStatus === 'error' ? (
              <>{t('metadata.saveError')}</>
            ) : (
              <>
                <Save size={16} />
                {t('metadata.save')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MetadataModal;
