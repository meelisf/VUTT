/**
 * Töökollektsioonide haldus (#354).
 *
 * Kogu on kureeritud teoste valik, mitte kollektsioon: teoste `collections`,
 * `is_public` ja `shareable` jäävad puutumata. Liikmesust ei indekseerita
 * Meilisearchi (ADR 0042) — liikmete arv tuleb serverilt kutsuja kohta.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2, Plus, Users, Archive, RotateCcw, Globe, Lock, Trash2 } from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { isAtLeast } from '../../utils/roleUtils';
import { getLangCode } from '../../utils/getLangCode';
import {
  WorkSetSummary, listWorkSets, createWorkSet, patchWorkSet, deleteWorkSet,
  getWorkSetWorkIds,
} from '../../services/workSetService';

const WorkSets: React.FC = () => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const { user, isLoading: userLoading } = useUser();
  const { refreshWorkSets } = useCollection();
  const navigate = useNavigate();
  const lang = getLangCode(i18n.language);

  const [sets, setSets] = useState<WorkSetSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const isAdmin = isAtLeast(user?.role, 'admin');

  useEffect(() => {
    if (!userLoading && !user) navigate('/');
  }, [user, userLoading, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWorkSets(showArchived);
      setSets(data);
      setError(null);
      // Liikmete arv on kutsujapõhine: sama kogu näitab eri inimestele eri arvu,
      // sest ligipääsmatud teosed ei ole loendis.
      const paarid = await Promise.all(data.map(async ws => {
        try { return [ws.id, (await getWorkSetWorkIds(ws.id)).length] as const; }
        catch { return [ws.id, -1] as const; }
      }));
      setCounts(Object.fromEntries(paarid));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { load(); }, [load]);

  const muuda = async (ws: WorkSetSummary, changes: Record<string, unknown>) => {
    setBusyId(ws.id);
    try {
      await patchWorkSet(ws.id, changes, ws.revision);
      await load();
      await refreshWorkSets();
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 409 ? t('workSets.conflict') : t('workSets.saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const kustuta = async (ws: WorkSetSummary) => {
    setBusyId(ws.id);
    try {
      await deleteWorkSet(ws.id);
      await load();
      await refreshWorkSets();
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 409 ? t('workSets.publishedCannotDelete') : t('workSets.saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const loo = async () => {
    if (!newName.trim()) return;
    setBusyId('new');
    try {
      await createWorkSet({ et: newName.trim(), en: newName.trim() });
      setNewName('');
      await load();
      await refreshWorkSets();
      setError(null);
    } catch {
      setError(t('workSets.saveFailed'));
    } finally {
      setBusyId(null);
    }
  };

  if (userLoading || !user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('workSets.title')} />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ChevronLeft size={16} /> Admin
        </Link>

        <h1 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Users size={22} className="text-primary-600" />
          {t('workSets.title')}
        </h1>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
        )}

        {isAdmin && (
          <div className="mb-6 flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('workSets.name')}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={loo}
              disabled={!newName.trim() || busyId === 'new'}
              className="inline-flex items-center gap-1 px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {busyId === 'new' ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t('workSets.create')}
            </button>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-gray-600 mb-3">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('workSets.showArchived')}
        </label>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" /></div>
        ) : sets.length === 0 ? (
          <p className="text-gray-500 text-center py-12">{t('workSets.empty')}</p>
        ) : (
          <div className="space-y-2">
            {sets.map(ws => {
              const arhiveeritud = ws.status === 'archived';
              const arv = counts[ws.id];
              return (
                <div key={ws.id} className={`bg-white border rounded-lg p-4 ${arhiveeritud ? 'border-gray-200 opacity-70' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-800 flex items-center gap-2">
                        {ws.name[lang] || ws.name.et || ws.name.en || ws.id}
                        {ws.visibility === 'public'
                          ? <Globe size={14} className="text-emerald-600" aria-label={t('workSets.visibilityPublic')} />
                          : <Lock size={14} className="text-gray-400" aria-label={t('workSets.visibilityMembers')} />}
                        {arhiveeritud && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            {t('workSets.statusArchived')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {/* −1 = loendi päring ebaõnnestus. Null EI OLE õige vastus:
                            „0 liiget" ja „ei saanud teada" on eri asjad. */}
                        {t('workSets.members')}: {arv === -1 ? '—' : arv ?? '…'}
                        {ws.access && ` · ${t('workSets.access')}: ${Object.keys(ws.access).length}`}
                      </div>
                    </div>

                    {ws.can_manage && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => muuda(ws, { status: arhiveeritud ? 'active' : 'archived' })}
                          disabled={busyId === ws.id}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                        >
                          {arhiveeritud ? <RotateCcw size={13} /> : <Archive size={13} />}
                          {arhiveeritud ? t('workSets.restore') : t('workSets.archive')}
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => muuda(ws, { visibility: ws.visibility === 'public' ? 'members' : 'public' })}
                            disabled={busyId === ws.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                          >
                            {ws.visibility === 'public' ? <Lock size={13} /> : <Globe size={13} />}
                            {ws.visibility === 'public' ? t('workSets.unpublish') : t('workSets.publish')}
                          </button>
                        )}
                        {isAdmin && !ws.ever_published && (
                          <button
                            onClick={() => kustuta(ws)}
                            disabled={busyId === ws.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-rose-200 text-rose-700 rounded hover:bg-rose-50 disabled:opacity-50"
                          >
                            <Trash2 size={13} /> {t('workSets.delete')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkSets;
