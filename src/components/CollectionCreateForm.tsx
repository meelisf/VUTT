/**
 * Uue kollektsiooni loomise vorm (#318).
 *
 * Elas varem `CollectionEditor`-i sees. Pärast detailvaate kasutuselevõttu oli
 * editor ainus mount ja loomine jäi PEITU teise, olemasoleva kogu seadete taha:
 * uue kogu tegemiseks pidi avama mõne olemasoleva kogu detaillehe. Vorm kuulub
 * kogude LOENDISSE, mitte ühe kogu lehele — seepärast on ta eraldi komponent,
 * mille mountib `CollectionsHub`.
 *
 * Peitmine ei ole autoriseerimine: `POST /admin/collections` jääb serveris
 * `require_role("superadmin")` taha.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Plus, ChevronUp } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { useUser } from '../contexts/UserContext';
import { buildCollectionTree } from '../services/collectionService';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { ColorPicker, renderTreeOptions } from './collectionFormControls';

interface Props {
  /** Loodud kogu id. Kutsuja otsustab, kuhu edasi minna. */
  onCreated?: (id: string) => void;
}

const CollectionCreateForm: React.FC<Props> = ({ onCreated }) => {
  const { t } = useTranslation(['admin', 'common']);
  const { authToken } = useUser();
  const { collections, refreshCollections } = useCollection();
  const tree = buildCollectionTree(collections);

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

  const handleCreate = async () => {
    setCreateError(null);
    setCreateSuccess(false);
    // Kliendipoolne valideerimine enne päringut
    if (!newId.trim() || !newNameEt.trim() || !newNameEn.trim()) return;
    if (collections[newId.trim()]) {
      setCreateError(t('collections.createErrorDuplicateId', { id: newId.trim() }));
      return;
    }
    setCreating(true);
    const loodudId = newId.trim();
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/collections`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
          body: JSON.stringify({
            id: loodudId,
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
        // Kontekst enne teavitust: kutsuja navigeerib loodud kogu juurde ja
        // detailvaade loeb kogu SEALT — värskendamata kontekst annaks
        // „Kollektsiooni ei leitud".
        await refreshCollections();
        setCreateSuccess(true);
        setNewId(''); setNewNameEt(''); setNewNameEn('');
        setNewParent(''); setNewColor('indigo'); setNewIsVirtual(false);
        setTimeout(() => setCreateSuccess(false), 3000);
        onCreated?.(loodudId);
      } else {
        setCreateError(data.message || t('collections.createError'));
      }
    } catch {
      setCreateError(t('collections.createError'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
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
              onChange={e => { setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setCreateError(null); }}
              placeholder="academia-gustaviana-2"
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                newId && collections[newId]
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300 focus:ring-primary-400'
              }`}
            />
            {newId && collections[newId] ? (
              <p className="text-xs text-red-600 mt-0.5">{t('collections.createErrorDuplicateId', { id: newId })}</p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">{t('collections.createIdHint')}</p>
            )}
          </div>

          {/* Nimed */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('collections.createNameEt')}</label>
              <input
                type="text"
                value={newNameEt}
                onChange={e => setNewNameEt(e.target.value)}
                placeholder={t('collections.createNameEt')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('collections.createNameEn')}</label>
              <input
                type="text"
                value={newNameEn}
                onChange={e => setNewNameEn(e.target.value)}
                placeholder={t('collections.createNameEn')}
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
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('collections.createColor')}</label>
              <ColorPicker value={newColor} onChange={setNewColor} />
              <p className="text-xs text-gray-400 mt-1">{newColor}</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
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
              disabled={creating || !newId.trim() || !newNameEt.trim() || !newNameEn.trim()}
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
  );
};

export default CollectionCreateForm;
