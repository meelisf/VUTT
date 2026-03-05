import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { buildCollectionTree, CollectionTreeNode, COLLECTION_COLOR_CLASSES } from '../services/collectionService';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

/**
 * Admin-komponent kollektsioonide haldamiseks:
 * - kirjelduste muutmine (PUT /admin/collections/{id})
 * - uue kollektsiooni lisamine (POST /admin/collections)
 * - kollektsiooni kustutamine (DELETE /admin/collections/{id})
 */

// Ehitab hierarhilise <option> massiivi puust (rekursiivne)
function renderTreeOptions(nodes: CollectionTreeNode[], depth = 0): React.ReactNode[] {
  const prefix = depth > 0 ? '\u00a0\u00a0\u00a0\u00a0'.repeat(depth) + '↳ ' : '';
  return nodes.flatMap(node => [
    <option key={node.id} value={node.id}>
      {prefix}{node.collection.name.et}
      {node.collection.type === 'virtual_group' ? ' (grupp)' : ''}
    </option>,
    ...renderTreeOptions(node.children, depth + 1),
  ]);
}

const AVAILABLE_COLORS = Object.keys(COLLECTION_COLOR_CLASSES);

const CollectionEditor: React.FC = () => {
  const { t } = useTranslation('admin');
  const { collections, refreshCollections } = useCollection();

  // --- Kirjelduse muutmine ---
  const [selectedId, setSelectedId] = useState<string>('');
  const [descEt, setDescEt] = useState('');
  const [descEn, setDescEn] = useState('');
  const [descLongEt, setDescLongEt] = useState('');
  const [descLongEn, setDescLongEn] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // --- Kustutamine ---
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteWorksCount, setDeleteWorksCount] = useState<number | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // --- Uue loomine ---
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState('');
  const [newNameEt, setNewNameEt] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newParent, setNewParent] = useState('');
  const [newColor, setNewColor] = useState('indigo');
  const [newIsVirtual, setNewIsVirtual] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const tree = buildCollectionTree(collections);

  // Reset tagasiside kui kasutaja vahetab kollektsiooni
  useEffect(() => {
    setSaved(false);
    setSaveError(null);
    setDeleteConfirming(false);
    setDeleteWorksCount(null);
    setDeleteInput('');
    setDeleteError(null);
  }, [selectedId]);

  // Lae valitud kollektsiooni andmed vormi
  useEffect(() => {
    if (!selectedId || !collections[selectedId]) {
      setDescEt(''); setDescEn(''); setDescLongEt(''); setDescLongEn('');
      return;
    }
    const col = collections[selectedId];
    setDescEt(col.description?.et || '');
    setDescEn(col.description?.en || '');
    setDescLongEt(col.description_long?.et || '');
    setDescLongEn(col.description_long?.en || '');
  }, [selectedId, collections]);

  const token = localStorage.getItem('vutt_token');

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/collections/${selectedId}?token=${encodeURIComponent(token || '')}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: { et: descEt.trim(), en: descEn.trim() },
            description_long: { et: descLongEt.trim(), en: descLongEn.trim() },
          }),
          timeout: 10000,
        }
      );
      const data = await res.json();
      if (data.status === 'success') {
        await refreshCollections();
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setSaveError(data.message || t('collections.saveError'));
      }
    } catch {
      setSaveError(t('collections.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleStartDelete = async () => {
    if (!selectedId) return;
    setDeleteConfirming(true);
    setDeleteWorksCount(null);
    setDeleteInput('');
    setDeleteError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/collections/${selectedId}/works-count?token=${encodeURIComponent(token || '')}`,
        { timeout: 10000 }
      );
      const data = await res.json();
      if (data.status === 'success') setDeleteWorksCount(data.count);
    } catch {
      // count jääb null — näitame confirm ilma arvuta
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/collections/${selectedId}?token=${encodeURIComponent(token || '')}`,
        { method: 'DELETE', timeout: 30000 }
      );
      const data = await res.json();
      if (data.status === 'success') {
        await refreshCollections();
        setSelectedId('');
        setDeleteConfirming(false);
        setDeleteInput('');
      } else {
        setDeleteError(data.message || t('collections.deleteError'));
        setDeleteConfirming(false);
      }
    } catch {
      setDeleteError(t('collections.deleteError'));
      setDeleteConfirming(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(false);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/collections?token=${encodeURIComponent(token || '')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newId.trim(),
            name_et: newNameEt.trim(),
            name_en: newNameEn.trim(),
            parent: newParent || null,
            color: newColor || null,
            is_virtual: newIsVirtual,
          }),
          timeout: 10000,
        }
      );
      const data = await res.json();
      if (data.status === 'success') {
        await refreshCollections();
        setCreateSuccess(true);
        setNewId(''); setNewNameEt(''); setNewNameEn('');
        setNewParent(''); setNewColor('indigo'); setNewIsVirtual(false);
        setTimeout(() => setCreateSuccess(false), 3000);
      } else {
        setCreateError(data.message || t('collections.createError'));
      }
    } catch {
      setCreateError(t('collections.createError'));
    } finally {
      setCreating(false);
    }
  };

  const selectedName = selectedId && collections[selectedId]
    ? (collections[selectedId].name.et)
    : '';

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold text-gray-800">{t('collections.title')}</h2>

      {/* Kollektsiooni valik */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('collections.selectCollection')}
        </label>
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
        >
          <option value="">{t('collections.selectCollection')}</option>
          {renderTreeOptions(tree)}
        </select>
      </div>

      {selectedId && (
        <div className="space-y-6">
          {/* Lühikirjeldus */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">{t('collections.description')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Eesti keeles</label>
                <textarea
                  value={descEt}
                  onChange={e => setDescEt(e.target.value)}
                  rows={3}
                  placeholder="Lühikirjeldus eesti keeles..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">In English</label>
                <textarea
                  value={descEn}
                  onChange={e => setDescEn(e.target.value)}
                  rows={3}
                  placeholder="Short description in English..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">{t('collections.descriptionHint')}</p>
          </div>

          {/* Pikk kirjeldus */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">{t('collections.descriptionLong')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Eesti keeles</label>
                <textarea
                  value={descLongEt}
                  onChange={e => setDescLongEt(e.target.value)}
                  rows={6}
                  placeholder="Pikem tutvustus eesti keeles..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">In English</label>
                <textarea
                  value={descLongEn}
                  onChange={e => setDescLongEn(e.target.value)}
                  rows={6}
                  placeholder="Longer introduction in English..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">{t('collections.descriptionLongHint')}</p>
          </div>

          {/* Salvesta + Kustuta */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? (
                <><Loader2 size={15} className="animate-spin" /> {t('collections.saving')}</>
              ) : saved ? (
                <><Check size={15} /> {t('collections.saveSuccess')}</>
              ) : (
                t('collections.save')
              )}
            </button>
            {saveError && <p className="text-sm text-red-600">{saveError}</p>}

            {!deleteConfirming && (
              <div className="ml-auto">
                <button
                  onClick={handleStartDelete}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={14} />
                  {t('collections.delete')}
                </button>
              </div>
            )}
          </div>

          {deleteConfirming && (
            <div className="border border-red-200 rounded-lg p-4 bg-red-50 space-y-3">
              <p className="text-sm text-red-800 font-medium">
                {t('collections.deleteConfirm', { name: selectedName })}
              </p>
              {deleteWorksCount !== null && (
                <p className="text-sm text-red-700">
                  {t('collections.deleteWorksWarning', { count: deleteWorksCount })}
                </p>
              )}
              <input
                type="text"
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                placeholder={t('collections.deleteInputPlaceholder', { word: t('collections.deleteConfirmWord') })}
                className="w-full px-3 py-2 text-sm border border-red-200 rounded focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                autoFocus
              />
              {deleteError && <p className="text-sm text-red-600 font-medium">{deleteError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleting || deleteInput !== t('collections.deleteConfirmWord')}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
                  {deleting ? t('collections.deleting') : t('collections.deleteConfirmBtn')}
                </button>
                <button
                  onClick={() => { setDeleteConfirming(false); setDeleteInput(''); setDeleteError(null); }}
                  className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Tühista
                </button>
              </div>
            </div>
          )

          }
          {!deleteConfirming && deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
        </div>
      )}

      {/* Lisa uus kollektsioon */}
      <div className="border-t border-gray-200 pt-6">
        <button
          onClick={() => setShowCreate(v => !v)}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          {showCreate ? <ChevronUp size={16} /> : <Plus size={16} />}
          {t('collections.createTitle')}
        </button>

        {showCreate && (
          <div className="mt-4 space-y-4 max-w-lg">
            {/* ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('collections.createId')}
              </label>
              <input
                type="text"
                value={newId}
                onChange={e => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="academia-gustaviana-2"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
              <p className="text-xs text-gray-400 mt-0.5">{t('collections.createIdHint')}</p>
            </div>

            {/* Nimed */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('collections.createNameEt')}</label>
                <input
                  type="text"
                  value={newNameEt}
                  onChange={e => setNewNameEt(e.target.value)}
                  placeholder="Nimi eesti keeles"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('collections.createNameEn')}</label>
                <input
                  type="text"
                  value={newNameEn}
                  onChange={e => setNewNameEn(e.target.value)}
                  placeholder="Name in English"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>

            {/* Vanem */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('collections.createParent')}</label>
              <select
                value={newParent}
                onChange={e => setNewParent(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
              >
                <option value="">{t('collections.createParentNone')}</option>
                {renderTreeOptions(tree)}
              </select>
            </div>

            {/* Värv + virtuaalne */}
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('collections.createColor')}</label>
                <select
                  value={newColor}
                  onChange={e => setNewColor(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                >
                  {AVAILABLE_COLORS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 pb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newIsVirtual}
                  onChange={e => setNewIsVirtual(e.target.checked)}
                  className="rounded border-gray-300"
                />
                {t('collections.createIsVirtual')}
              </label>
            </div>

            {/* Lisa nupp */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleCreate}
                disabled={creating || !newId || !newNameEt}
                className="inline-flex items-center gap-2 px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? (
                  <><Loader2 size={15} className="animate-spin" /> {t('collections.creating')}</>
                ) : createSuccess ? (
                  <><Check size={15} /> {t('collections.createSuccess')}</>
                ) : (
                  <><Plus size={15} /> {t('collections.create')}</>
                )}
              </button>
              {createError && <p className="text-sm text-red-600">{createError}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CollectionEditor;
