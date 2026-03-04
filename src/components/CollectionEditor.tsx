import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { buildCollectionTree, CollectionTreeNode } from '../services/collectionService';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

/**
 * Admin-komponent kollektsioonide lühikirjelduste ja pikkade kirjelduste muutmiseks.
 * Salvestab PUT /admin/collections/{id} kaudu.
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

const CollectionEditor: React.FC = () => {
  const { t } = useTranslation('admin');
  const { collections, refreshCollections } = useCollection();

  const [selectedId, setSelectedId] = useState<string>('');
  const [descEt, setDescEt] = useState('');
  const [descEn, setDescEn] = useState('');
  const [descLongEt, setDescLongEt] = useState('');
  const [descLongEn, setDescLongEn] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hierarhiline puu (order järgi, peakollektsioonid ees)
  const tree = buildCollectionTree(collections);

  // Reset tagasiside kui kasutaja vahetab kollektsiooni
  useEffect(() => {
    setSaved(false);
    setError(null);
  }, [selectedId]);

  // Lae valitud kollektsiooni andmed vormi (ka pärast refreshCollections)
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

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const token = localStorage.getItem('vutt_token');
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
        // Laadib kollektsioonid uuesti → CollectionInfoBanner näeb uusi kirjeldusi kohe
        await refreshCollections();
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(data.message || t('collections.saveError'));
      }
    } catch {
      setError(t('collections.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">{t('collections.title')}</h2>

      {/* Kollektsiooni valik — hierarhiline */}
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

          {/* Salvesta nupp */}
          <div className="flex items-center gap-3">
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
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectionEditor;
