import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronLeft, Wrench } from 'lucide-react';
import Header from '../../components/Header';
import { FILE_API_URL } from '../../config';
import { useUser } from '../../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';

type ActionState = 'idle' | 'running' | 'done' | 'error';

const Maintenance: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [placeLabelsState, setPlaceLabelsState] = useState<ActionState>('idle');
  const [placeLabelsCount, setPlaceLabelsCount] = useState<number | null>(null);
  const [entityLabelsState, setEntityLabelsState] = useState<ActionState>('idle');
  const [entityLabelsCount, setEntityLabelsCount] = useState<number | null>(null);
  const [enrichPageTagsState, setEnrichPageTagsState] = useState<ActionState>('idle');
  const [enrichPageTagsCount, setEnrichPageTagsCount] = useState<number | null>(null);
  const [archives, setArchives] = useState<Record<string, { name: string; url?: string }>>({});
  const [archivesLoaded, setArchivesLoaded] = useState(false);
  const [showAddArchive, setShowAddArchive] = useState(false);
  const [addId, setAddId] = useState('');
  const [addName, setAddName] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [deleteForceConfirm, setDeleteForceConfirm] = useState<{ id: string; message: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  React.useEffect(() => {
    if (!userLoading && (!user || user.role !== 'admin')) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  const handleRefreshPlaceLabels = async () => {
    if (!authToken) return;
    setPlaceLabelsState('running');
    setPlaceLabelsCount(null);
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/prosopography/admin/places/refresh-labels`, {
        method: 'POST',
        headers: getAuthHeaders(authToken),
        timeout: 120000,
      });
      if (!resp.ok) throw new Error(String(resp.status));
      const data = await resp.json();
      setPlaceLabelsCount(data.updated ?? 0);
      setPlaceLabelsState('done');
    } catch {
      setPlaceLabelsState('error');
    }
  };

  const handleEnrichPageTagLabels = async () => {
    if (!authToken) return;
    setEnrichPageTagsState('running');
    setEnrichPageTagsCount(null);
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/admin/enrich-page-tag-labels`, {
        method: 'POST',
        headers: getAuthHeaders(authToken),
        timeout: 30000,
      });
      if (!resp.ok) throw new Error(String(resp.status));
      const data = await resp.json();
      setEnrichPageTagsCount(data.queued ?? 0);
      setEnrichPageTagsState('done');
    } catch {
      setEnrichPageTagsState('error');
    }
  };

  const handleRefreshEntityLabels = async () => {
    if (!authToken) return;
    setEntityLabelsState('running');
    setEntityLabelsCount(null);
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/admin/refresh-entity-labels`, {
        method: 'POST',
        headers: getAuthHeaders(authToken),
        timeout: 120000,
      });
      if (!resp.ok) throw new Error(String(resp.status));
      const data = await resp.json();
      setEntityLabelsCount(data.updated ?? 0);
      setEntityLabelsState('done');
    } catch {
      setEntityLabelsState('error');
    }
  };

  React.useEffect(() => {
    if (!authToken) return;
    fetchWithTimeout(`${FILE_API_URL}/config/archives`, { headers: getAuthHeaders(authToken) })
      .then(r => r.json())
      .then(d => { if (d.archives) { setArchives(d.archives); setArchivesLoaded(true); } })
      .catch(() => {});
  }, [authToken]);

  const handleAddArchive = async () => {
    const trimId = addId.trim();
    const trimName = addName.trim();
    const trimUrl = addUrl.trim();
    if (!trimId || !trimName) { setAddError(t('admin:archives.idNameRequired')); return; }
    if (archives[trimId]) { setAddError(t('admin:archives.duplicateId', { id: trimId })); return; }
    setAddSaving(true); setAddError('');
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/config/archives`, {
        method: 'POST',
        headers: { ...getAuthHeaders(authToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: trimId, name: trimName, ...(trimUrl ? { url: trimUrl } : {}) }),
      });
      if (!resp.ok) { const e = await resp.json(); setAddError(e.detail || t('common:error.unknown')); return; }
      setArchives(prev => ({ ...prev, [trimId]: { name: trimName, ...(trimUrl ? { url: trimUrl } : {}) } }));
      setAddId(''); setAddName(''); setAddUrl('');
      setShowAddArchive(false);
    } catch { setAddError(t('common:error.unknown')); }
    finally { setAddSaving(false); }
  };

  const handleUpdateArchive = async (id: string) => {
    const trimName = editName.trim();
    const trimUrl = editUrl.trim();
    if (!trimName) { setEditError(t('admin:archives.nameRequired')); return; }
    setEditSaving(true); setEditError('');
    try {
      const resp = await fetchWithTimeout(`${FILE_API_URL}/config/archives/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(authToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimName, ...(trimUrl ? { url: trimUrl } : {}) }),
      });
      if (!resp.ok) { const e = await resp.json(); setEditError(e.detail || t('common:error.unknown')); return; }
      setArchives(prev => ({ ...prev, [id]: { name: trimName, ...(trimUrl ? { url: trimUrl } : {}) } }));
      setEditingId(null);
    } catch { setEditError(t('common:error.unknown')); }
    finally { setEditSaving(false); }
  };

  const handleDeleteArchive = async (id: string, force = false) => {
    try {
      const resp = await fetchWithTimeout(
        `${FILE_API_URL}/config/archives/${encodeURIComponent(id)}${force ? '?force=true' : ''}`,
        { method: 'DELETE', headers: getAuthHeaders(authToken) },
      );
      if (resp.status === 409) {
        const e = await resp.json();
        setDeleteForceConfirm({ id, message: e.detail });
        return;
      }
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        setDeleteError(e.detail || t('admin:archives.deleteFailed'));
        return;
      }
      setDeleteError('');
      setArchives(prev => { const n = { ...prev }; delete n[id]; return n; });
      setDeleteForceConfirm(null);
    } catch { /* ignore */ }
  };

  if (userLoading || !user) return null;
  if (user.role !== 'admin') return null;

  const actions = [
    {
      key: 'placeLabels',
      label: t('admin:maintenance.refreshPlaceLabels'),
      desc: t('admin:maintenance.refreshPlaceLabelsDesc'),
      state: placeLabelsState,
      count: placeLabelsCount,
      doneKey: 'refreshPlaceLabelsDone' as const,
      onClick: handleRefreshPlaceLabels,
    },
    {
      key: 'entityLabels',
      label: t('admin:maintenance.refreshEntityLabels'),
      desc: t('admin:maintenance.refreshEntityLabelsDesc'),
      state: entityLabelsState,
      count: entityLabelsCount,
      doneKey: 'refreshEntityLabelsDone' as const,
      onClick: handleRefreshEntityLabels,
    },
    {
      key: 'enrichPageTagLabels',
      label: t('admin:maintenance.enrichPageTagLabels'),
      desc: t('admin:maintenance.enrichPageTagLabelsDesc'),
      state: enrichPageTagsState,
      count: enrichPageTagsCount,
      doneKey: 'enrichPageTagLabelsDone' as const,
      onClick: handleEnrichPageTagLabels,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('admin:maintenance.title')} />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        <div className="flex items-center gap-2 mb-4">
          <Wrench size={20} className="text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-800">{t('admin:maintenance.title')}</h2>
        </div>

        {/* Arhiivide register */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">{t('admin:archives.title')}</h3>
            <button
              onClick={() => { setShowAddArchive(a => !a); setAddId(''); setAddName(''); setAddUrl(''); setAddError(''); }}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 border border-primary-200 rounded px-2 py-1 hover:bg-primary-50"
            >
              + {t('admin:archives.addArchive')}
            </button>
          </div>

          {showAddArchive && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <input
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                  placeholder={t('admin:archives.idPlaceholder')}
                  value={addId}
                  onChange={e => { setAddId(e.target.value); setAddError(''); }}
                />
                <input
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                  placeholder={t('admin:archives.name')}
                  value={addName}
                  onChange={e => { setAddName(e.target.value); setAddError(''); }}
                />
                <input
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                  placeholder={t('admin:archives.url')}
                  value={addUrl}
                  onChange={e => setAddUrl(e.target.value)}
                />
              </div>
              {addError && <p className="text-xs text-red-600">{addError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleAddArchive}
                  disabled={addSaving}
                  className="text-xs bg-primary-600 text-white rounded px-3 py-1.5 hover:bg-primary-700 disabled:opacity-50"
                >
                  {addSaving ? '...' : t('common:buttons.save')}
                </button>
                <button
                  onClick={() => setShowAddArchive(false)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  {t('common:buttons.cancel')}
                </button>
              </div>
            </div>
          )}

          {deleteError && (
            <p className="text-xs text-red-600 mb-2">{deleteError}</p>
          )}

          {archivesLoaded && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 font-medium">
                    <th className="text-left px-3 py-2 w-24">{t('admin:archives.id')}</th>
                    <th className="text-left px-3 py-2">{t('admin:archives.name')}</th>
                    <th className="text-left px-3 py-2 w-40">{t('admin:archives.url')}</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(archives).map(([id, info]) => (
                    <tr key={id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs font-medium text-gray-700">{id}</td>
                      {editingId === id ? (
                        <>
                          <td className="px-3 py-2">
                            <input
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                              value={editName}
                              onChange={e => { setEditName(e.target.value); setEditError(''); }}
                            />
                            {editError && <p className="text-xs text-red-600 mt-0.5">{editError}</p>}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-primary-400 outline-none"
                              value={editUrl}
                              onChange={e => setEditUrl(e.target.value)}
                              placeholder="https://..."
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleUpdateArchive(id)}
                                disabled={editSaving}
                                className="text-xs text-primary-600 hover:text-primary-800 disabled:opacity-50"
                              >
                                {editSaving ? '...' : t('common:buttons.save')}
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="text-xs text-gray-400 hover:text-gray-600"
                              >
                                {t('common:buttons.cancel')}
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-gray-800">{info.name}</td>
                          <td className="px-3 py-2">
                            {info.url ? (
                              <a href={info.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline truncate block max-w-[140px]">
                                {info.url.replace(/^https?:\/\//, '')} ↗
                              </a>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-2 justify-end items-center">
                              {pendingDeleteId === id ? (
                                <>
                                  <button
                                    onClick={() => { setPendingDeleteId(null); handleDeleteArchive(id); }}
                                    className="text-xs text-red-600 hover:text-red-800 font-medium"
                                  >
                                    {t('common:buttons.delete')}
                                  </button>
                                  <button
                                    onClick={() => setPendingDeleteId(null)}
                                    className="text-xs text-gray-400 hover:text-gray-700"
                                  >
                                    {t('common:buttons.cancel')}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => { setEditingId(id); setEditName(info.name); setEditUrl(info.url || ''); setEditError(''); }}
                                    className="text-xs text-gray-400 hover:text-gray-700"
                                    title={t('common:buttons.edit')}
                                  >
                                    ✎
                                  </button>
                                  <button
                                    onClick={() => setPendingDeleteId(id)}
                                    className="text-xs text-gray-300 hover:text-red-400"
                                    title={t('common:buttons.delete')}
                                  >
                                    ×
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {actions.map(({ key, label, desc, state, count, doneKey, onClick }) => (
            <div key={key} className="flex items-center justify-between px-4 py-4 gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                {state === 'done' && count !== null && (
                  <p className="text-xs text-green-700 mt-1">
                    {t(`admin:maintenance.${doneKey}`, { count })}
                  </p>
                )}
                {state === 'error' && (
                  <p className="text-xs text-red-600 mt-1">{t('admin:maintenance.refreshError')}</p>
                )}
              </div>
              <button
                onClick={onClick}
                disabled={state === 'running'}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 text-gray-700"
              >
                <RefreshCw size={12} className={state === 'running' ? 'animate-spin' : ''} />
                {state === 'running' ? t('admin:maintenance.refreshing') : t('admin:maintenance.refresh')}
              </button>
            </div>
          ))}
        </div>

        {deleteForceConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-lg shadow-xl p-5 w-80 space-y-3">
              <p className="text-sm font-semibold text-gray-800">{deleteForceConfirm.message}</p>
              <p className="text-xs text-gray-500">{t('admin:archives.deleteInUseWarning')}</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeleteForceConfirm(null)}
                  className="text-sm text-gray-500 px-3 py-1.5"
                >
                  {t('common:buttons.cancel')}
                </button>
                <button
                  onClick={() => handleDeleteArchive(deleteForceConfirm.id, true)}
                  className="text-sm bg-red-600 text-white rounded px-3 py-1.5 hover:bg-red-700"
                >
                  {t('common:buttons.delete')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Maintenance;
