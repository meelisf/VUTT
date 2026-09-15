import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Trash2 } from 'lucide-react';
import { useCollection } from '../contexts/CollectionContext';
import { useUser } from '../contexts/UserContext';
import { buildCollectionTree } from '../services/collectionService';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import { apiPost } from '../services/apiClient';
import CollectionAccessPanel from './CollectionAccessPanel';
import { ColorPicker, renderTreeOptions } from './collectionFormControls';
import { RightsUser } from '../pages/admin/collectionRightsDraft';

/**
 * Admin-komponent OLEMASOLEVA kollektsiooni haldamiseks:
 * - kirjelduste muutmine (PUT /admin/collections/{id})
 * - kollektsiooni kustutamine (DELETE /admin/collections/{id})
 *
 * Uue kogu loomine EI OLE siin: ta kuulub kogude loendisse, mitte ühe kogu
 * lehele (#318) — vt `CollectionCreateForm`.
 */

interface CollectionEditorProps {
  /**
   * Kas kutsuja tohib kogu STRUKTUURI ja SEADEID muuta? Väär adminil:
   * ligipääs on admin+, seaded superadmin (ADR 0043 p4). Peitmine EI OLE
   * autoriseerimine — serveri `require_role("superadmin")` jääb alles.
   */
  canEditSettings?: boolean;
  /** Juhitav valik. Kui antud, ei hoia editor oma valikut. */
  selectedId?: string;
  onSelectId?: (id: string) => void;
  /** Kas näidata editori enda kogu-valijat? Hubis valib rida. */
  showPicker?: boolean;
  /**
   * Kas renderdada sisemine `CollectionAccessPanel`? Detailvaates on ligipääs
   * OMAETTE tab — ilma selle propita näeks superadmin sama paneeli kaks korda
   * (üks kord „Ligipääs", teist korda „Seaded" sees).
   */
  showAccessPanel?: boolean;
}

const CollectionEditor: React.FC<CollectionEditorProps> = ({
  canEditSettings = true, selectedId, onSelectId, showPicker = true,
  showAccessPanel = true,
}) => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken } = useUser();
  const { collections, refreshCollections } = useCollection();
  // Paneelile stabiilne viide: objektiliteraal iga renderduse peal
  // käivitaks paneeli memo'd uuesti.
  const actor = useMemo(
    () => ({ username: user?.username || '', role: user?.role || '' }),
    [user]);

  // --- Kirjelduse muutmine ---
  // Juhitav/juhtimata muster: ilma `selectedId` propita töötab editor edasi
  // täpselt nagu enne (oma valik, oma valija) — see hoiab olemasoleva
  // kasutuskoha muutmatuna, kuni hub on valmis.
  const [omaValik, setOmaValik] = useState<string>('');
  const juhitud = selectedId !== undefined;
  const valitud = juhitud ? selectedId : omaValik;
  const vahetaValik = (id: string) => {
    if (!juhitud) setOmaValik(id);
    onSelectId?.(id);
  };
  const [descEt, setDescEt] = useState('');
  const [descEn, setDescEn] = useState('');
  const [descLongEt, setDescLongEt] = useState('');
  const [descLongEn, setDescLongEn] = useState('');
  const [editColor, setEditColor] = useState('indigo');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Nähtavus on superadmini seade; õigused elavad eraldi paneelis (ADR 0043).
  const [editVisibility, setEditVisibility] = useState<'public' | 'restricted'>('public');
  // Ligipääsupaneeli üldloend. `usersKnown` eristab „loend on tõesti tühi"
  // ja „loendit ei saanud laadida" (1b õppetund) — tühja loendi tõlgendamine
  // teadmiseks oleks vale vastus.
  const [allUsers, setAllUsers] = useState<RightsUser[]>([]);
  const [usersKnown, setUsersKnown] = useState(false);

  // --- Kustutamine ---
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteWorksCount, setDeleteWorksCount] = useState<number | null>(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // --- Uue loomine ---

  // Lae kõik kasutajad üks kord (paneeli otsingu jaoks)
  useEffect(() => {
    if (!authToken) return;
    apiPost<{ status: string; users?: RightsUser[] }>('/admin/users', {}, { token: authToken })
      .then(data => { setAllUsers(data.users || []); setUsersKnown(true); })
      // Loendi puudumine EI blokeeri paneeli: olemasolevad määrangud jäävad
      // nähtavaks, ainult lisamine jääb tegemata.
      .catch(() => { setAllUsers([]); setUsersKnown(false); });
  }, [authToken]);

  const tree = buildCollectionTree(collections);

  // Reset tagasiside kui kasutaja vahetab kollektsiooni
  useEffect(() => {
    setSaved(false);
    setSaveError(null);
    setDeleteConfirming(false);
    setDeleteWorksCount(null);
    setDeleteInput('');
    setDeleteError(null);
  }, [valitud]);

  // Lae valitud kollektsiooni andmed vormi
  useEffect(() => {
    if (!valitud || !collections[valitud]) {
      setDescEt(''); setDescEn(''); setDescLongEt(''); setDescLongEn('');
      return;
    }
    const col = collections[valitud];
    setDescEt(col.description?.et || '');
    setDescEn(col.description?.en || '');
    setDescLongEt(col.description_long?.et || '');
    setDescLongEn(col.description_long?.en || '');
    setEditColor(col.color || 'indigo');
    setEditVisibility((col.visibility as 'public' | 'restricted') || 'public');
  }, [valitud, collections]);

  const handleSave = async () => {
    if (!valitud) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/collections/${valitud}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
          body: JSON.stringify({
            description: { et: descEt.trim(), en: descEn.trim() },
            description_long: { et: descLongEt.trim(), en: descLongEn.trim() },
            color: editColor,
            visibility: editVisibility,
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
    if (!valitud) return;
    setDeleteConfirming(true);
    setDeleteWorksCount(null);
    setDeleteInput('');
    setDeleteError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/collections/${valitud}/works-count`,
        { headers: getAuthHeaders(authToken), timeout: 10000 }
      );
      const data = await res.json();
      if (data.status === 'success') setDeleteWorksCount(data.count);
    } catch {
      // count jääb null — näitame confirm ilma arvuta
    }
  };

  const handleDelete = async () => {
    if (!valitud) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/collections/${valitud}`,
        { method: 'DELETE', headers: getAuthHeaders(authToken), timeout: 30000 }
      );
      const data = await res.json();
      if (data.status === 'success') {
        await refreshCollections();
        vahetaValik('');
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

  const selectedName = valitud && collections[valitud]
    ? (collections[valitud].name.et)
    : '';

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold text-gray-800">{t('collections.title')}</h2>

      {/* Kollektsiooni valik */}
      {showPicker && (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('collections.selectCollection')}
        </label>
        <select
          value={valitud}
          onChange={e => vahetaValik(e.target.value)}
          className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
        >
          <option value="">{t('collections.selectCollection')}</option>
          {renderTreeOptions(tree)}
        </select>
      </div>
      )}

      {!canEditSettings && (
        <p className="text-sm text-gray-500">{t('collections.superadminOnlyHint')}</p>
      )}

      {valitud && (
        <div className="space-y-6">
          {/* Seaded on superadmini piir (ADR 0043 p4). */}
          {canEditSettings && (
            <>
          {/* Värv */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('collections.createColor')}</label>
            <ColorPicker value={editColor} onChange={setEditColor} />
            <p className="text-xs text-gray-400 mt-1">{editColor}</p>
          </div>

          {/* Nähtavus */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">{t('collections.visibility')}</p>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={editVisibility === 'public'}
                  onChange={() => setEditVisibility('public')}
                  className="text-primary-600"
                />
                <span className="text-sm">{t('collections.visibilityPublic')}</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="visibility"
                  value="restricted"
                  checked={editVisibility === 'restricted'}
                  onChange={() => setEditVisibility('restricted')}
                  className="text-primary-600"
                />
                <span className="text-sm text-amber-700">{t('collections.visibilityRestricted')}</span>
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {t('collections.visibilityHint')}
            </p>
          </div>
            </>
          )}

          {/* Ligipääs on nähtavuse valiku KÕRVAL, mitte sees: kirjutamisulatust
              saab määrata ka avalikul kogul ja lugemisõigust piiratud kogul
              (ADR 0031 — kaks eri telge). */}
          {user && showAccessPanel && (
            <CollectionAccessPanel
              // Nähtavuse salvestus muudab määrangute TÄHENDUST („määratud" vs
              // „praegu ei mõju"). Paneel laeb oma oleku ise ega näe seda
              // muutust — võti sunnib ta uuesti laadima. Enne salvestust
              // radio lülitamine võtit ei muuda, seega mustand jääb alles.
              key={`${valitud}:${collections[valitud]?.visibility || 'public'}`}
              collectionId={valitud}
              users={allUsers}
              usersKnown={usersKnown}
              actor={actor}
              onSaved={() => { void refreshCollections(); }}
            />
          )}

          {canEditSettings && (
            <>
          {/* Lühikirjeldus */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">{t('collections.description')}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('collections.langEt')}</label>
                <textarea
                  value={descEt}
                  onChange={e => setDescEt(e.target.value)}
                  rows={3}
                  placeholder={t('collections.descriptionPlaceholderEt')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('collections.langEn')}</label>
                <textarea
                  value={descEn}
                  onChange={e => setDescEn(e.target.value)}
                  rows={3}
                  placeholder={t('collections.descriptionPlaceholderEn')}
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
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('collections.langEt')}</label>
                <textarea
                  value={descLongEt}
                  onChange={e => setDescLongEt(e.target.value)}
                  rows={6}
                  placeholder={t('collections.descriptionLongPlaceholderEt')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('collections.langEn')}</label>
                <textarea
                  value={descLongEn}
                  onChange={e => setDescLongEn(e.target.value)}
                  rows={6}
                  placeholder={t('collections.descriptionLongPlaceholderEn')}
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
                  {t('common:buttons.cancel')}
                </button>
              </div>
            </div>
          )

          }
          {!deleteConfirming && deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
            </>
          )}
        </div>
      )}

    </div>
  );
};

export default CollectionEditor;
