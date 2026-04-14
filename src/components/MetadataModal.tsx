import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Edit3, X, Save, Plus, Trash2, Library, ChevronDown, ExternalLink, UserRound } from 'lucide-react';
import { getVocabularies, Vocabularies, Collections, buildCollectionTree, CollectionTreeNode } from '../services/collectionService';
import { Creator, CreatorRole, Page, Work, ArchiveRef } from '../types';
import { LinkedEntity } from '../types/LinkedEntity';
import { getLabel } from '../utils/metadataUtils';
import { getEntityUrl } from '../utils/entityUrl';
import EntityPicker, { PeopleRegisterEntry } from './EntityPicker';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { getLangCode } from '../utils/getLangCode';
import { ErrorBanner } from './ErrorBanner';
import { buildMetadataPayload } from '../utils/buildMetadataPayload';

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
  year_display: string;                // Kuvatav aasta (nt "ca. 1680"), tühi = kasuta year numbrit
  type: string | LinkedEntity | null;  // LinkedEntity Wikidata linkimiseks
  genre: (string | LinkedEntity)[];  // Mitu žanrit
  tags: (string | LinkedEntity)[];
  location: string | LinkedEntity;
  publisher: string | LinkedEntity;
  creators: Creator[];
  languages: string[];
  ester_id: string;
  external_url: string;
  collections: string[];
  archive_refs: ArchiveRef[];
}

interface SuggestionItem {
  label: string;
  id: string | null;
}

// Hierarhiline kollektsiooni multi-select dropdown MetadataModal jaoks
interface CollectionDropdownProps {
  collections: Collections;
  selected: string[];
  lang: 'et' | 'en';
  onChange: (next: string[]) => void;
  label: string;
}

function CollectionDropdownTreeNode({
  node, selected, onChange, lang, depth
}: {
  node: CollectionTreeNode; selected: string[]; onChange: (next: string[]) => void; lang: 'et' | 'en'; depth: number;
}) {
  const col = node.collection;
  const isVirtual = col.type === 'virtual_group';
  return (
    <>
      <label
        className={`flex items-center gap-2 text-sm rounded px-2 py-1 ${isVirtual ? 'text-gray-400 cursor-default' : 'cursor-pointer hover:bg-gray-50'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <input
          type="checkbox"
          disabled={isVirtual}
          checked={selected.includes(node.id)}
          onChange={e => {
            const next = e.target.checked
              ? [...selected, node.id]
              : selected.filter(c => c !== node.id);
            onChange(next);
          }}
          className="rounded border-gray-300"
        />
        <span className={isVirtual ? 'italic' : ''}>{col.name[lang] || col.name.et}</span>
      </label>
      {node.children.map(child => (
        <CollectionDropdownTreeNode key={child.id} node={child} selected={selected} onChange={onChange} lang={lang} depth={depth + 1} />
      ))}
    </>
  );
}

export const CollectionDropdown: React.FC<CollectionDropdownProps> = ({ collections, selected, lang, onChange, label }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tree = buildCollectionTree(collections);

  // Sulge väljaspool klikkides
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedLabels = selected
    .map(id => collections[id]?.name[lang] || collections[id]?.name.et || id)
    .join(', ');

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
        <Library size={12} />
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between border border-gray-300 rounded px-3 py-2 text-sm bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 text-left"
      >
        <span className={selected.length === 0 ? 'text-gray-400' : 'text-gray-800'}>
          {selected.length === 0 ? '—' : selectedLabels}
        </span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto py-1">
          {tree.map(node => (
            <CollectionDropdownTreeNode key={node.id} node={node} selected={selected} onChange={onChange} lang={lang} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
};

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
  const lang = getLangCode(i18n.language);

  const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
  const [archives, setArchives] = useState<Record<string, { name: string; url?: string }>>({});
  const [metaForm, setMetaForm] = useState<MetadataForm>({
    title: '',
    year: 0,
    year_display: '',
    type: null,
    genre: [],
    tags: [],
    location: '',
    publisher: '',
    creators: [],
    languages: [],
    ester_id: '',
    external_url: '',
    collections: [],
    archive_refs: [],
  });
  const [suggestions, setSuggestions] = useState<{
    authors: SuggestionItem[];
    tags: SuggestionItem[];
    places: SuggestionItem[];
    printers: SuggestionItem[];
    types: SuggestionItem[];
    genres: SuggestionItem[];
  }>({ authors: [], tags: [], places: [], printers: [], types: [], genres: [] });
  const [peopleRegister, setPeopleRegister] = useState<PeopleRegisterEntry[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Drag-to-move
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragOffset.current = { x: e.clientX - (dragPos?.x ?? 0), y: e.clientY - (dragPos?.y ?? 0) };
    const onMove = (ev: MouseEvent) => {
      if (!dragOffset.current) return;
      setDragPos({ x: ev.clientX - dragOffset.current.x, y: ev.clientY - dragOffset.current.y });
    };
    const onUp = () => {
      dragOffset.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Lae andmed kui modal avatakse
  useEffect(() => {
    if (isOpen) {
      loadData();
      setDragPos(null);
    }
  }, [isOpen]);

  const loadData = async () => {
    // Ehita creators massiiv olemasolevatest andmetest
    const initialCreators: Creator[] = [];
    if (page.autor) {
      initialCreators.push({ name: page.autor, role: 'auctor' });
    }
    if (page.respondens) {
      initialCreators.push({ name: page.respondens, role: 'respondens' });
    }

    // Algväärtused page/work objektidest
    setMetaForm({
      title: work?.title || page.title || '',
      year: work?.year || page.year || page.aasta || 0,
      year_display: work?.year_display || page.year_display || '',
      type: work?.type || page.type || null,
      genre: (() => { const g = work?.genre ?? page.genre; return Array.isArray(g) ? g : (g ? [g] : []); })(),
      tags: work?.tags || page.tags || [],
      location: work?.location || page.location || '',
      publisher: work?.publisher || page.publisher || '',
      creators: work?.creators || page.creators || initialCreators,
      languages: work?.languages || page.languages || [],
      ester_id: work?.ester_id || page.ester_id || '',
      external_url: work?.external_url || page.external_url || '',
      collections: work?.collections || page.collections || [],
      archive_refs: work?.archive_refs || [],
    });

    // Lae sõnavara
    const vocabs = await getVocabularies();
    setVocabularies(vocabs);

    // Lae arhiivide register
    try {
      const archivesResp = await fetchWithTimeout(`${FILE_API_URL}/config/archives`);
      const archivesData = await archivesResp.json();
      if (archivesData.archives) setArchives(archivesData.archives);
    } catch { /* kasuta tühja loendit kui ei õnnestu */ }

    // Lae soovitused ja isikute register paralleelselt
    fetchSuggestions();
    fetchPeopleRegister();

    // Lae serverist värskeim metadata
    await fetchServerMetadata();
  };

  const fetchSuggestions = async () => {
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/get-metadata-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({ lang })
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

  const fetchPeopleRegister = async () => {
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/people-register`);
      const data = await response.json();
      if (data.status === 'success') {
        setPeopleRegister(data.people || []);
      }
    } catch (e) {
      console.error("Viga isikute registri laadimisel", e);
    }
  };

  const fetchServerMetadata = async () => {
    let payload: any = { work_id: workId };
    if (page.originaal_kataloog) {
      payload.original_path = page.originaal_kataloog;
    }

    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/get-work-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
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
          if (m.autor) creators.push({ name: m.autor, role: 'auctor' });
          if (m.respondens) creators.push({ name: m.respondens, role: 'respondens' });
        }

        setMetaForm({
          title: title,
          year: year ? parseInt(year) : 0,
          year_display: m.year_display || '',
          type: m.type || null,
          genre: (() => { const g = m.genre; return Array.isArray(g) ? g : (g ? [g] : []); })(),
          tags: Array.isArray(tags) ? tags : [],
          location: location || '',
          publisher: publisher || '',
          creators: creators,
          languages: m.languages || [],
          ester_id: m.ester_id || '',
          external_url: m.external_url || '',
          collections: Array.isArray(m.collections) ? m.collections : [],
          archive_refs: Array.isArray(m.archive_refs) ? m.archive_refs : [],
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
      const payload = buildMetadataPayload(metaForm, workId, page.originaal_kataloog);

      const response = await fetchWithTimeout(`${FILE_API_URL}/update-work-metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify(payload),
        timeout: 30000
      });

      const data = await response.json();
      if (data.status === 'success') {
        const { metadata: m } = payload;
        const successData = {
          title: m.title,
          year: m.year,
          year_display: m.year_display,
          type: m.type as LinkedEntity | null,
          genre: m.genre as LinkedEntity[] | null,
          creators: m.creators,
          tags: m.tags as LinkedEntity[],
          languages: metaForm.languages,
          location: m.location as LinkedEntity | null,
          publisher: m.publisher as LinkedEntity | null,
          ester_id: m.ester_id ?? undefined,
          external_url: m.external_url ?? undefined,
          collections: m.collections,
        };
        onSaveSuccess(successData as Partial<Page>, successData as Partial<Work>);

        setSaveStatus('success');
        setTimeout(() => {
          onClose();
          setSaveStatus('idle');
        }, 1500);
      } else {
        setSaveStatus('error');
        setSaveError(t('editor.saveErrorWithMessage', { message: data.message }));
      }
    } catch (e) {
      console.error("Metadata save failed", e);
      setSaveStatus('error');
      setSaveError(t('editor.saveErrorServer'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col"
        style={dragPos
          ? { position: 'fixed', left: dragPos.x, top: dragPos.y, transform: 'none', margin: 0 }
          : { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', margin: 0 }
        }
        onClick={e => e.stopPropagation()}
      >
        <div
          className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={handleDragStart}
        >
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
                  creators: [...metaForm.creators, { name: '', role: 'auctor' as CreatorRole }]
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
                            source: (val?.source === 'local' ? 'manual' : val?.source) || 'manual'
                          };
                          setMetaForm({ ...metaForm, creators: newCreators });
                        }}
                        placeholder={t('metadata.creatorName', 'Nimi')}
                        lang={lang}
                        localSuggestions={suggestions.authors}
                        peopleRegister={peopleRegister}
                        showPersonToggle
                        defaultPersonSearch
                        token={authToken}
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

          {/* Grupp 2: Kolofoon */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
            <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">{t('metadata.colophon', 'Kolofoon')}</h4>
            {/* Rida 1: Aasta */}
            <div className="grid grid-cols-2 gap-3">
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
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('metadata.yearDisplay')}</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                  placeholder={t('metadata.yearDisplayPlaceholder', 'nt ca. 1680')}
                  value={metaForm.year_display}
                  onChange={e => setMetaForm({ ...metaForm, year_display: e.target.value })}
                />
              </div>
            </div>
            {/* Rida 2: Koht ja trükkal */}
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <EntityPicker
                  label={t('metadata.printer')}
                  type="printer"
                  value={metaForm.publisher}
                  onChange={val => setMetaForm({ ...metaForm, publisher: val || '' })}
                  lang={lang}
                  localSuggestions={suggestions.printers}
                  peopleRegister={peopleRegister}
                  showPersonToggle
                  defaultPersonSearch
                  token={authToken}
                />
              </div>
            </div>
          </div>

          {/* Grupp 3: Klassifikatsioon */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
            <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">{t('metadata.classification', 'Klassifikatsioon')}</h4>
            {/* Kollektsioon */}
            <CollectionDropdown
              collections={collections}
              selected={metaForm.collections}
              lang={lang}
              onChange={next => setMetaForm({ ...metaForm, collections: next })}
              label={t('metadata.collection')}
            />
            {/* Žanrid — nagu märksõnad: pillid + picker */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">{t('metadata.genre', 'Žanr')}</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {metaForm.genre.length === 0 && <span className="text-xs text-gray-400 italic">{t('metadata.noGenres', 'Žanrid puuduvad')}</span>}
                {metaForm.genre.map((g, i) => {
                  const genreObj = typeof g !== 'string' ? g as any : null;
                  const url = genreObj ? getEntityUrl(genreObj.id, genreObj.source) : null;
                  return (
                    <span key={i} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border ${
                      genreObj?.id ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-gray-100 border-gray-200 text-gray-700'
                    }`}>
                      {getLabel(g, lang)}
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="opacity-50 hover:opacity-100" title={genreObj?.id || ''} onClick={e => e.stopPropagation()}>
                          <ExternalLink size={10} />
                        </a>
                      )}
                      <button onClick={() => setMetaForm({ ...metaForm, genre: metaForm.genre.filter((_, j) => j !== i) })} className="hover:text-red-500">
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
              <EntityPicker
                type="genre"
                value={null}
                alreadySelected={metaForm.genre.filter(g => typeof g !== 'string') as LinkedEntity[]}
                onChange={val => {
                  if (!val) return;
                  if (val.id) {
                    const idx = metaForm.genre.findIndex(
                      g => typeof g !== 'string' && (g as LinkedEntity).id === val.id
                    );
                    if (idx !== -1) {
                      const newGenre = [...metaForm.genre];
                      const existing = newGenre[idx] as LinkedEntity;
                      newGenre[idx] = { ...existing, labels: { ...existing.labels, ...val.labels } };
                      setMetaForm({ ...metaForm, genre: newGenre });
                      return;
                    }
                  }
                  setMetaForm({ ...metaForm, genre: [...metaForm.genre, val] });
                }}
                placeholder={t('metadata.genrePlaceholder', 'Lisa žanr...')}
                lang={lang}
                localSuggestions={suggestions.genres}
              />
            </div>
            {/* Tüüp */}
            <div className="w-1/3">
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
                {metaForm.tags.map((tag, idx) => {
                  const tagObj = typeof tag !== 'string' ? tag as any : null;
                  const url = tagObj ? getEntityUrl(tagObj.id, tagObj.source) : null;
                  const isPerson = tagObj?.entity_type === 'person' || tagObj?.id?.startsWith('vutt:P');
                  const personId = isPerson && tagObj?.id?.startsWith('vutt:P') ? tagObj.id : null;
                  return (
                    <span key={idx} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border ${
                      isPerson ? 'bg-primary-50 border-primary-200 text-primary-700'
                      : tagObj?.id ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-gray-100 border-gray-200 text-gray-700'
                    }`}>
                      {getLabel(tag, lang)}
                      {personId && (
                        <Link to={`/persons/${personId}`} target="_blank" rel="noopener noreferrer" className="opacity-50 hover:opacity-100" title="Vaata isiku lehte" onClick={e => e.stopPropagation()}>
                          <UserRound size={10} />
                        </Link>
                      )}
                      {!personId && url && (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="opacity-50 hover:opacity-100" title={tagObj?.id || ''} onClick={e => e.stopPropagation()}>
                          <ExternalLink size={10} />
                        </a>
                      )}
                      <button
                        onClick={() => setMetaForm({ ...metaForm, tags: metaForm.tags.filter((_, i) => i !== idx) })}
                        className="hover:text-red-500"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>

              <EntityPicker
                type="topic"
                value={null}
                alreadySelected={metaForm.tags.filter(t => typeof t !== 'string') as LinkedEntity[]}
                onChange={val => {
                  if (!val) return;
                  if (val.id) {
                    const idx = metaForm.tags.findIndex(
                      t => typeof t !== 'string' && (t as LinkedEntity).id === val.id
                    );
                    if (idx !== -1) {
                      const newTags = [...metaForm.tags];
                      const existing = newTags[idx] as LinkedEntity;
                      newTags[idx] = { ...existing, labels: { ...existing.labels, ...val.labels } };
                      setMetaForm({ ...metaForm, tags: newTags });
                      return;
                    }
                  }
                  setMetaForm({ ...metaForm, tags: [...metaForm.tags, val] });
                }}
                placeholder={t('metadata.tagsPlaceholder', 'Lisa märksõna...')}
                lang={lang}
                localSuggestions={suggestions.tags}
                showPersonToggle
                token={authToken}
              />
              <p className="text-[10px] text-gray-400 mt-1 italic">
                {t('metadata.tagsHint')}
              </p>
            </div>
          </div>

          {/* Grupp 4: Arhiiviviited */}
          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50/50">
            <h4 className="text-xs font-bold text-gray-600 uppercase -mt-1">{t('metadata.archiveRefs', 'Arhiiviviited')}</h4>
            <div className="space-y-2">
              {metaForm.archive_refs.map((ref, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <select
                    className="border border-gray-300 rounded px-2 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white w-28 shrink-0"
                    value={ref.archive_id}
                    onChange={e => setMetaForm({ ...metaForm, archive_refs: metaForm.archive_refs.map((r, i) => i === idx ? { ...r, archive_id: e.target.value } : r) })}
                  >
                    <option value="">— Arhiiv —</option>
                    {Object.entries(archives).map(([id, info]) => (
                      <option key={id} value={id}>{id} — {info.name}</option>
                    ))}
                  </select>
                  <div className="flex-1 space-y-1">
                    <textarea
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white resize-none"
                      rows={2}
                      placeholder={t('metadata.archiveRefPlaceholder', 'Viide (nt fond, nimistu, säilik, lehed)')}
                      value={ref.reference}
                      onChange={e => setMetaForm({ ...metaForm, archive_refs: metaForm.archive_refs.map((r, i) => i === idx ? { ...r, reference: e.target.value } : r) })}
                    />
                    <input
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none bg-white"
                      placeholder={t('metadata.archiveRefUrl', 'URL (valikuline)')}
                      value={ref.url || ''}
                      onChange={e => setMetaForm({ ...metaForm, archive_refs: metaForm.archive_refs.map((r, i) => i === idx ? { ...r, url: e.target.value } : r) })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setMetaForm({ ...metaForm, archive_refs: metaForm.archive_refs.filter((_, i) => i !== idx) })}
                    className="text-gray-400 hover:text-red-500 mt-1 shrink-0 text-lg leading-none"
                    title={t('common:buttons.remove', 'Eemalda')}
                  >×</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setMetaForm({ ...metaForm, archive_refs: [...metaForm.archive_refs, { archive_id: '', reference: '', url: '' }] })}
                className="text-xs text-primary-600 hover:text-primary-800 hover:underline"
              >+ {t('metadata.addArchiveRef', 'Lisa arhiiviviide')}</button>
            </div>
          </div>

          {/* Grupp 5: Välised lingid */}
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
        {saveError && (
          <div className="px-4 pt-3 shrink-0">
            <ErrorBanner
              message={saveError}
              onClose={() => setSaveError(null)}
            />
          </div>
        )}
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
