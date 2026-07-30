import React, { useState, useEffect, useRef } from 'react';
import { isAtLeast } from '../../utils/roleUtils';
import { useParams, useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowLeftRight, Save, X, Loader2, ImagePlus, Trash2, ExternalLink } from 'lucide-react';
import Header from '../../components/Header';
import MarkdownEditor from '../../components/MarkdownEditor';
import EntityPicker from '../../components/EntityPicker';
import { FILE_API_URL } from '../../config';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import { getPerson, createPerson, updatePerson, uploadPersonImage, deletePersonImage, deletePerson } from '../services/prosopographyService';
import { useUser } from '../../contexts/UserContext';
import type { ProsopoRecord } from '../types';

import { type FormDraft, type OccupationDraft, type EducationDraft, emptyDraft, emptyDateDraft } from '../components/personForm/types';
import { recordToDraft, draftToPayload } from '../components/personForm/helpers';
import DateField from '../components/personForm/DateField';
import AliasesList from '../components/personForm/AliasesList';
import ProsopoPersonPicker from '../components/personForm/ProsopoPersonPicker';
import TagsList from '../components/personForm/TagsList';
import { CollapsibleSection, DynamicList } from '../components/personForm/CollapsibleSection';
import EnrichmentSearch from '../components/personForm/EnrichmentSearch';
import EnrichExistingSection from '../components/personForm/EnrichExistingSection';
import PlacePicker from '../components/personForm/PlacePicker';
import { formatRelationOwnerName, formatRelationTypeLabel } from '../utils/estonianName';
import { getVocabularies } from '../../services/collectionService';
import type { VocabularySeisusItem } from '../../services/collectionService';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import UnsavedChangesDialog from '../../components/UnsavedChangesDialog';

const PersonEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo: string = (location.state as any)?.from ?? '/persons';
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation(['prosopography', 'common']);
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
  // Seose tüüpide soovitused kõigist kaartidest
  const [relationTypeSuggestions, setRelationTypeSuggestions] = useState<{ label: string; id: string | null; labels?: Record<string, string> | null }[]>([]);
  // Seisuste sõnavara
  const [seisused, setSeisused] = useState<VocabularySeisusItem[]>([]);
  // Konfessioonide sõnavara
  const [konfessioonid, setKonfessioonid] = useState<VocabularySeisusItem[]>([]);
  // Salvestamata muudatuste jälgimine
  const [isDirty, setIsDirty] = useState(false);
  const lang = i18n.language?.slice(0, 2) ?? 'et';

  // Profiilipilt
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageDragOver, setImageDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canEdit = isAtLeast(user?.role, 'editor');
  const isAdmin = isAtLeast(user?.role, 'admin');

  // Kustutamine
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!id || deleteInput !== t('deleteConfirmWord')) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePerson(id, token);
      navigate('/persons', { replace: true });
    } catch (e) {
      setDeleteError((e as Error).message);
      setDeleting(false);
    }
  };

  // Suuna mitteeditor kasutaja tagasi
  useEffect(() => {
    if (!canEdit) navigate(isNew ? '/persons' : `/persons/${id!}`, { replace: true });
  }, [canEdit]);

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
    fetchWithTimeout(`${FILE_API_URL}/prosopography/relation-type-suggestions`)
      .then(r => r.json())
      .then((data: { label: string; id: string | null; labels?: Record<string, string> | null }[]) => {
        const items = data.map(d => ({
          label: (d.labels?.[lang] || d.labels?.['et'] || d.labels?.['en'] || d.label),
          id: d.id ?? null,
          labels: d.labels ?? null,
        }));
        setRelationTypeSuggestions(items);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    getVocabularies().then(v => {
      if (v.seisused) setSeisused(v.seisused);
      if (v.konfessioonid) setKonfessioonid(v.konfessioonid);
    }).catch(() => {});
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
      .catch(() => setError(t('loadErrorSingle')))
      .finally(() => setLoading(false));
  }, [id, token]);

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { setImageError(t('form.photoError.notImage')); return; }
    if (file.size > 10 * 1024 * 1024) { setImageError(t('form.photoError.tooLarge')); return; }
    if (isNew) { setImageError(t('form.saveFirstPhoto')); return; }
    setImageUploading(true);
    setImageError(null);
    try {
      const result = await uploadPersonImage(id!, file, token);
      setImageUrl(result.image_url);
      if (result.updated_at) {
        setOriginal(prev => prev ? { ...prev, updated_at: result.updated_at } : prev);
      }
    } catch (e: any) {
      setImageError(e.message ?? t('form.photoError.uploadFailed'));
    } finally {
      setImageUploading(false);
    }
  };

  const handleImageDelete = async () => {
    if (!id || isNew) return;
    setImageUploading(true);
    setImageError(null);
    try {
      const result = await deletePersonImage(id, token);
      setImageUrl(null);
      if (result.updated_at) {
        setOriginal(prev => prev ? { ...prev, updated_at: result.updated_at } : prev);
      }
    } catch {
      setImageError(t('form.photoError.deleteFailed'));
    } finally {
      setImageUploading(false);
    }
  };

  const set = (patch: Partial<FormDraft>) => { setIsDirty(true); setDraft(d => ({ ...d, ...patch })); };

  // Uue isiku ID tekib alles salvestamisel — hoiame selle navigeerimiseks alles.
  const createdIdRef = useRef<string | null>(null);

  /**
   * Salvestab isiku. EI navigeeri — sihtkoha valib kutsuja (nupp läheb profiilile,
   * salvestamata muudatuste dialoog jätkab kasutaja algatatud üleminekut).
   * Tagastab `true` ainult siis, kui kõik on püsivalt salvestatud.
   */
  const savePerson = async (): Promise<boolean> => {
    if (!draft.name_label.trim()) { setError(t('form.nameRequired')); return false; }
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
        const payload = draftToPayload(draft, created, seisused, konfessioonid);
        await updatePerson(created.id, { ...payload, updated_at: created.updated_at }, token);
        createdIdRef.current = created.id;
      } else {
        const payload = draftToPayload(draft, original ?? undefined, seisused, konfessioonid);
        await updatePerson(id!, payload, token);
      }
      setIsDirty(false);
      return true;
    } catch (e: any) {
      if (e?.conflict) {
        setError(t('form.conflictError'));
      } else {
        setError(t('form.saveError'));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const { dialogProps, allowNextNavigation } = useUnsavedChangesGuard({
    isDirty,
    onSave: savePerson,
  });

  /** Lehe oma SALVESTA nupp: salvestab ja läheb profiilile. */
  const handleSave = async () => {
    const ok = await savePerson();
    if (!ok) return;
    // Guard ei tohi seda navigatsiooni blokeerida: `isDirty` on Reacti järgmise
    // renderduseni tõenäoliselt veel `true`.
    allowNextNavigation();
    navigate(`/persons/${createdIdRef.current ?? id!}`);
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
          <p className="text-gray-600 text-sm mb-4">{t('form.loginRequired')}</p>
          <button onClick={() => navigate(backTo)} className="text-primary-600 hover:underline text-sm">
            ← {t('backToList')}
          </button>
        </div>
      </div>
    );
  }

  const pageTitle = isNew
    ? t('addPerson', 'Lisa isik')
    : original?.name.label ?? t('edit', 'Muuda isikut');

  const inputCls = "px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none";

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      <Header />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">

        {/* Tagasi */}
        <button
          onClick={() => navigate(isNew ? '/persons' : `/persons/${id!}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary-600 transition-colors mb-4"
        >
          <ArrowLeft size={15} />
          {isNew ? t('backToList') : t('backToProfile')}
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
            {saving ? t('form.saving') : t('form.save')}
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
              <strong>{t('enrich.enrichedWith', { source:
                enrichedWith.scheme === 'wikidata' ? t('enrich.sourceWikidata') :
                enrichedWith.scheme === 'gnd' ? t('enrich.sourceGnd') :
                enrichedWith.scheme === 'album_academicum' ? t('enrich.sourceAa') :
                t('enrich.sourceViaf')
              })}</strong>
              {' '}({enrichedWith.id})
              {enrichedWith.fields.length > 0 && (
                <span className="text-green-700"> — {t('enrich.enrichedFields')} {enrichedWith.fields.join(', ')}</span>
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
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-3">{t('form.profilePhoto')}</label>
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
                {imageUrl ? t('form.changePhoto') : t('form.addPhoto')}
              </button>
              {imageUrl && (
                <button
                  type="button"
                  disabled={imageUploading}
                  onClick={handleImageDelete}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                >
                  <Trash2 size={13} />
                  {t('form.removePhoto')}
                </button>
              )}
              <p className="text-xs text-gray-400 leading-snug">
                {t('form.photoHint')}<br />
                {isNew && <span className="text-amber-600">{t('form.saveFirst')}</span>}
              </p>
              {imageError && <p className="text-xs text-red-600">{imageError}</p>}
            </div>
          </div>
        </div>

        {/* ── Identiteedi kaart ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5 space-y-5">

          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t('form.nameLabel')} <span className="text-red-500">*</span>
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
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{t('form.nameFirst')}</label>
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
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{t('form.nameFamily')}</label>
              <input
                type="text"
                value={draft.name_family}
                onChange={e => set({ name_family: e.target.value })}
                placeholder="von Münchhausen"
                className={`w-full ${inputCls}`}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">{t('form.nameQualifier')}</label>
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
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1.5">{t('form.gender')}</label>
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
                  {v === '' ? t('form.genderUnknown') : v === 'M' ? t('filterMale') : t('filterFemale')}
                </label>
              ))}
            </div>
          </div>

          {/* Eluaastad */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DateField
              label={t('born', 'Sündinud')}
              value={draft.birth}
              onChange={v => set({ birth: v })}
              localSuggestions={entityLabels}
            />
            <DateField
              label={t('died', 'Surnud')}
              value={draft.death}
              onChange={v => set({ death: v })}
              localSuggestions={entityLabels}
            />
          </div>

          {/* Seisus + konfessioon */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('statuses', 'Seisus')}
              </label>
              <div className="flex flex-wrap gap-2">
                {seisused.map(item => {
                  const label = i18n.language?.startsWith('en') ? item.label.en : item.label.et;
                  const checked = (draft.statuses ?? []).includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        set({
                          statuses: checked
                            ? (draft.statuses ?? []).filter(id => id !== item.id)
                            : [...(draft.statuses ?? []), item.id],
                        })
                      }
                      className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                        checked
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-primary-400'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
                {seisused.length === 0 && (
                  <span className="text-xs text-gray-400 italic">{t('loadingVocab', 'Laadin…')}</span>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('confession', 'Konfessioon')}
              </label>
              <div className="flex flex-wrap gap-2">
                {konfessioonid.map(item => {
                  const label = i18n.language?.startsWith('en') ? item.label.en : item.label.et;
                  const checked = (draft.confessions ?? []).includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        set({
                          confessions: checked
                            ? (draft.confessions ?? []).filter(id => id !== item.id)
                            : [...(draft.confessions ?? []), item.id],
                        })
                      }
                      className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                        checked
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-primary-400'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
                {konfessioonid.length === 0 && (
                  <span className="text-xs text-gray-400 italic">{t('loadingVocab', 'Laadin…')}</span>
                )}
              </div>
            </div>
          </div>


          {/* Floruit */}
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t('form.floruit')} <span className="normal-case font-normal text-gray-400">({t('form.floruitHint')})</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={1000} max={1900}
                placeholder={t('form.from')}
                value={draft.floruit_from}
                onChange={e => set({ floruit_from: e.target.value })}
                className={`w-20 ${inputCls}`}
              />
              <span className="text-gray-400">–</span>
              <input
                type="number" min={1000} max={1900}
                placeholder={t('form.to')}
                value={draft.floruit_to}
                onChange={e => set({ floruit_to: e.target.value })}
                className={`w-20 ${inputCls}`}
              />
            </div>
          </div>
        </div>

        {/* ── Päritolukoht ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5">
          <PlacePicker
            value={draft.origin_place || null}
            onChange={key => set({ origin_place: key ?? '' })}
            token={token}
            canEdit={!!canEdit}
            lang={lang}
          />
        </div>

        {/* ── Elulugu ── */}
        <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5">
          <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">
            {t('biography', 'Elulugu')}
          </label>
          <MarkdownEditor
            value={draft.biography}
            onChange={v => set({ biography: v })}
            minRows={8}
            placeholder={t('form.biographyPlaceholder')}
          />
        </div>

        {/* ── Nimevariandid ja identifikaatorid (klapitav) ── */}
        <CollapsibleSection
          title={t('form.namesAndIdentifiers')}
          open={namesOpen}
          onToggle={() => setNamesOpen(v => !v)}
        >
          <AliasesList
            aliases={draft.name_aliases}
            onChange={v => set({ name_aliases: v })}
          />
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">{t('form.identifiers')}</label>
            <div className="space-y-2">
              {[
                { key: 'wikidata_id', label: 'Wikidata', placeholder: 'Q12345', url: (v: string) => `https://www.wikidata.org/wiki/${v}` },
                { key: 'gnd_id', label: 'GND', placeholder: '123456789', url: (v: string) => `https://d-nb.info/gnd/${v}` },
                { key: 'viaf_id', label: 'VIAF', placeholder: '12345678', url: (v: string) => `https://viaf.org/viaf/${v}` },
                { key: 'aa_id', label: 'Album Academicum', placeholder: 'AA:123', url: null },
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
          <EnrichExistingSection
            personId={isNew ? undefined : id}
            wikidataId={draft.wikidata_id}
            gndId={draft.gnd_id}
            aaId={draft.aa_id}
            viafId={draft.viaf_id}
            draft={draft}
            token={token}
            onChange={newDraft => setDraft(newDraft)}
            onApplied={fields => {
              if (fields.some(f => f === '_occupations' || f === '_occupation_label')) setOccupOpen(true);
            }}
          />
        </CollapsibleSection>

        {/* ── Ametid ja haridus (klapitav) ── */}
        <CollapsibleSection
          title={t('form.occupationsAndEducation')}
          open={occupOpen}
          onToggle={() => setOccupOpen(v => !v)}
        >
          <DynamicList
            label={t('occupations', 'Ametid')}
            items={draft.occupations}
            renderItem={(item: OccupationDraft, onChange, onRemove) => (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-0.5">{t('form.occupation')}</label>
                    <EntityPicker
                      placeholder={t('form.occupationPlaceholder')}
                      type="topic"
                      value={item.id ? { label: item.label, id: item.id, labels: item.labels, source: 'wikidata' } : (item.label ? { label: item.label, id: null, labels: null, source: 'manual' } : null)}
                      onChange={v => onChange({ ...item, label: v?.label ?? '', id: v?.id ?? null, labels: v?.labels ?? undefined })}
                      lang={lang}
                      localSuggestions={entityLabels}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-0.5">{t('form.institution')}</label>
                    <EntityPicker
                      placeholder={t('form.institutionPlaceholder')}
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
                <div className="grid grid-cols-2 gap-2">
                  <DateField
                    label={t('form.from')}
                    value={item.date_from ?? emptyDateDraft()}
                    onChange={v => onChange({ ...item, date_from: v })}
                    showPlace={false}
                  />
                  <DateField
                    label={t('form.to')}
                    value={item.date_to ?? emptyDateDraft()}
                    onChange={v => onChange({ ...item, date_to: v })}
                    showPlace={false}
                  />
                </div>
              </div>
            )}
            onAdd={() => set({ occupations: [...draft.occupations, { label: '', date_from: emptyDateDraft(), date_to: emptyDateDraft() }] })}
            onChange={items => set({ occupations: items })}
          />

          <DynamicList
            label={t('education', 'Haridus')}
            items={draft.education}
            renderItem={(item: EducationDraft, onChange, onRemove) => (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs text-gray-400 mb-0.5">{t('form.educationInstitution')}</label>
                    <EntityPicker
                      placeholder={t('form.educationInstitutionPlaceholder')}
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
                <div className="grid grid-cols-2 gap-2">
                  <DateField
                    label={t('form.from')}
                    value={item.date_from ?? emptyDateDraft()}
                    onChange={v => onChange({ ...item, date_from: v })}
                    showPlace={false}
                  />
                  <DateField
                    label={t('form.to')}
                    value={item.date_to ?? emptyDateDraft()}
                    onChange={v => onChange({ ...item, date_to: v })}
                    showPlace={false}
                  />
                </div>
              </div>
            )}
            onAdd={() => set({ education: [...draft.education, { institution: '', date_from: emptyDateDraft(), date_to: emptyDateDraft() }] })}
            onChange={items => set({ education: items })}
          />

          <TagsList tags={draft.tags} onChange={v => set({ tags: v })} />
        </CollapsibleSection>

        {/* ── Seosed ja märkmed (klapitav) ── */}
        <CollapsibleSection
          title={t('form.relationsAndNotes')}
          open={relOpen}
          onToggle={() => setRelOpen(v => !v)}
        >
          <DynamicList
            label={t('relations', 'Seosed')}
            items={draft.relations}
            renderItem={(item, onChange, onRemove) => (
              <div>
                <div className="flex items-center gap-2">
                  <ProsopoPersonPicker value={item} onChange={onChange} token={token} currentId={id} />
                  <div className="w-44 shrink-0" title={t('form.relationTypeHint')}>
                    <EntityPicker
                      type="topic"
                      value={item.type_id
                        ? { id: item.type_id, label: item.type, labels: item.type_labels ?? {}, source: 'wikidata' as const }
                        : item.type || null
                      }
                      onChange={entity => onChange({
                        ...item,
                        type: entity?.label ?? '',
                        type_id: (entity?.id && !entity.id.startsWith('local-')) ? entity.id : null,
                        type_labels: entity?.labels ?? null,
                      })}
                      placeholder={t('form.relationPlaceholder')}
                      lang={lang}
                      localSuggestions={relationTypeSuggestions}
                    />
                  </div>
                  {item.target_id && (
                    <span
                      title={
                        item.reciprocal_auto
                          ? t('form.reciprocalAutoTooltip')
                          : t('form.reciprocalTooltip')
                      }
                      className="shrink-0 text-gray-400"
                    >
                      <ArrowLeftRight size={13} />
                    </span>
                  )}
                  <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0">
                    <X size={14} />
                  </button>
                </div>
                {item.name && item.type && (
                  <p className="text-xs text-gray-400 italic mt-0.5 pl-1">
                    {t('form.relationSentence', {
                      other: item.target_id
                        ? '\x00LINK\x00'
                        : item.name,
                      self: formatRelationOwnerName(draft.name_label || '…', lang),
                      type: formatRelationTypeLabel(item.type, item.type_labels, lang),
                    }).split('\x00LINK\x00').flatMap((part, i, arr) =>
                      i < arr.length - 1
                        ? [part, <Link key="l" to={`/persons/${item.target_id!}`} className="underline hover:text-gray-600" target="_blank" rel="noopener noreferrer">{item.name}</Link>]
                        : [part]
                    )}
                  </p>
                )}
              </div>
            )}
            onAdd={() => set({ relations: [...draft.relations, { name: '', type: '', target_id: null }] })}
            onChange={items => set({ relations: items })}
          />

          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
              {t('notes', 'Märkmed')}
            </label>
            <MarkdownEditor
              value={draft.notes}
              onChange={v => set({ notes: v })}
              minRows={3}
              placeholder={t('form.notesPlaceholder')}
            />
          </div>
        </CollapsibleSection>

        {/* ── Allikad ja bibliograafia (klapitav) ── */}
        <CollapsibleSection
          title={t('form.sourcesAndBibliography')}
          open={sourcesOpen}
          onToggle={() => setSourcesOpen(v => !v)}
        >
          <DynamicList
            label={t('form.sources')}
            items={draft.sources}
            renderItem={(item, onChange, onRemove) => (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={item.text}
                      onChange={e => onChange({ ...item, text: e.target.value })}
                      placeholder={t('form.sourcePlaceholder')}
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
                  placeholder={t('form.sourceNote')}
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
            {saving ? t('form.saving') : t('form.save')}
          </button>
        </div>

        {/* Kustutamine — ainult admin, olemasolevate isikute puhul */}
        {isAdmin && !isNew && (
          <div className="mt-8 border border-red-200 rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-red-700">{t('deleteSection.title')}</p>
            {!deleteOpen ? (
              <button
                onClick={() => { setDeleteOpen(true); setDeleteInput(''); setDeleteError(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} />
                {t('deleteSection.button')}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-red-800">{t('deleteSection.warning')}</p>
                <input
                  type="text"
                  value={deleteInput}
                  onChange={e => setDeleteInput(e.target.value)}
                  placeholder={t('deleteSection.placeholder', { word: t('deleteConfirmWord') })}
                  className="w-full px-3 py-2 text-sm border border-red-200 rounded focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  autoFocus
                />
                {deleteError && <p className="text-sm text-red-600 font-medium">{deleteError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting || deleteInput !== t('deleteConfirmWord')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    {t('deleteSection.confirm')}
                  </button>
                  <button
                    onClick={() => { setDeleteOpen(false); setDeleteError(null); }}
                    className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
                  >
                    {t('common:actions.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>

    <UnsavedChangesDialog {...dialogProps} />
    </>
  );
};

export default PersonEditPage;
