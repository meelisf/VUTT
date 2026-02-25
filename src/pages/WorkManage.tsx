import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Trash2,
  Plus,
  Loader2,
  Wrench,
  AlertTriangle,
  RotateCcw,
  FileImage,
  ArrowUpDown,
} from 'lucide-react';
import Header from '../components/Header';
import { FILE_API_URL, IMAGE_BASE_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

interface PageInfo {
  page_num: number;
  sequence: number;
  base_name: string;
  filename: string;
  lehekylje_pilt: string;
  status: string;
  has_text: boolean;
}

interface DeletedPage {
  filename: string;
  base_name: string;
  deleted_at: string | null;
  deleted_by: string | null;
  commit_hash: string | null;
}

type ActiveTab = 'pages' | 'trash';

const WorkManage: React.FC = () => {
  const { t } = useTranslation(['workspace', 'common']);
  const { workId } = useParams<{ workId: string }>();
  const navigate = useNavigate();
  const { user, authToken } = useUser();

  const [activeTab, setActiveTab] = useState<ActiveTab>('pages');
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workTitle, setWorkTitle] = useState('');

  // Lehekülje kustutamine
  const [deletingPage, setDeletingPage] = useState<number | null>(null);
  const [deletePageError, setDeletePageError] = useState<string | null>(null);

  // Lehekülje lisamine
  const [showAddForm, setShowAddForm] = useState(false);
  const [addAfterPage, setAddAfterPage] = useState<number>(-1);
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addingPage, setAddingPage] = useState(false);
  const [addPageError, setAddPageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prügikast (kustutatud leheküljed)
  const [trashPages, setTrashPages] = useState<DeletedPage[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [restoringPage, setRestoringPage] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Lehekülgede järjekorra muutmine
  const [draftPositions, setDraftPositions] = useState<Record<string, number>>({});
  const [reorderSaving, setReorderSaving] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  // Teose kustutamine
  const [deleteWorkConfirm, setDeleteWorkConfirm] = useState(false);
  const [deleteWorkInput, setDeleteWorkInput] = useState('');
  const [deletingWork, setDeletingWork] = useState(false);
  const [deleteWorkError, setDeleteWorkError] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (user && !isAdmin) {
      navigate(`/work/${workId}/1`);
    }
  }, [user, isAdmin, workId, navigate]);

  const loadPages = async () => {
    if (!workId || !authToken) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}/pages?token=${authToken}`,
        { method: 'GET' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status === 'success') {
        setPages(data.pages || []);
      } else {
        setLoadError(t('manage.loadError'));
      }
    } catch (e) {
      setLoadError(t('manage.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const loadTrashPages = async () => {
    if (!workId || !authToken) return;
    setTrashLoading(true);
    setTrashError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}/trash-pages?token=${authToken}`,
        { method: 'GET' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status === 'success') {
        setTrashPages(data.pages || []);
        setTrashLoaded(true);
      } else {
        setTrashError(t('manage.trash.loadError'));
      }
    } catch {
      setTrashError(t('manage.trash.loadError'));
    } finally {
      setTrashLoading(false);
    }
  };

  useEffect(() => {
    if (!workId || !authToken) return;
    fetchWithTimeout(`${FILE_API_URL}/get-work-metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_id: workId, auth_token: authToken })
    })
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setWorkTitle(d.metadata?.title || workId || ''); })
      .catch(() => {});
  }, [workId, authToken]);

  useEffect(() => {
    if (isAdmin) loadPages();
  }, [workId, authToken, isAdmin]);

  useEffect(() => {
    const init: Record<string, number> = {};
    pages.forEach(p => { init[p.filename] = p.page_num; });
    setDraftPositions(init);
  }, [pages]);

  const hasReorderChanges = pages.some(p => draftPositions[p.filename] !== p.page_num);

  const handleReorderSave = async () => {
    if (!workId || !authToken) return;
    const confirmed = window.confirm(t('manage.reorderConfirm'));
    if (!confirmed) return;

    // Sorteeri pages draftPositions järgi, võta filename järjekord
    const sorted = [...pages].sort((a, b) => {
      const pa = draftPositions[a.filename] ?? a.page_num;
      const pb = draftPositions[b.filename] ?? b.page_num;
      return pa - pb;
    });
    const order = sorted.map(p => p.filename);

    setReorderSaving(true);
    setReorderError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}/reorder-pages?token=${authToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order }),
          timeout: 30000,
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      await loadPages();
    } catch (e: any) {
      setReorderError(e.message || t('manage.reorderError'));
    } finally {
      setReorderSaving(false);
    }
  };

  const handleDeletePage = async (pageNum: number) => {
    if (!workId || !authToken) return;
    const confirmed = window.confirm(t('manage.deletePageConfirm', { num: pageNum }));
    if (!confirmed) return;

    setDeletingPage(pageNum);
    setDeletePageError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}/page/${pageNum}?token=${authToken}`,
        { method: 'DELETE', timeout: 15000 }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status === 'success') {
        await loadPages();
        // Kui prügikast on laetud, uuenda ka seda
        if (trashLoaded) loadTrashPages();
      } else {
        setDeletePageError(t('manage.deletePageError'));
      }
    } catch {
      setDeletePageError(t('manage.deletePageError'));
    } finally {
      setDeletingPage(null);
    }
  };

  const handleAddPage = async () => {
    if (!workId || !authToken || !addFile) return;
    setAddingPage(true);
    setAddPageError(null);

    try {
      const formData = new FormData();
      formData.append('file', addFile);
      formData.append('after_page_num', String(addAfterPage));

      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}/add-page?token=${authToken}`,
        { method: 'POST', body: formData, timeout: 30000 }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.status === 'success') {
        setShowAddForm(false);
        setAddFile(null);
        setAddAfterPage(-1);
        if (fileInputRef.current) fileInputRef.current.value = '';
        await loadPages();
      } else {
        setAddPageError(t('manage.addPageError'));
      }
    } catch (e: any) {
      setAddPageError(e.message || t('manage.addPageError'));
    } finally {
      setAddingPage(false);
    }
  };

  const handleRestorePage = async (filename: string) => {
    if (!workId || !authToken) return;
    setRestoringPage(filename);
    setRestoreMessage(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}/trash-pages/${encodeURIComponent(filename)}/restore?token=${authToken}`,
        { method: 'POST', timeout: 30000 }
      );
      const data = await res.json();
      if (data.status === 'success') {
        setRestoreMessage({ text: t('manage.trash.restoreSuccess', { name: filename }), ok: true });
        setTrashPages(prev => prev.filter(p => p.filename !== filename));
        // Uuenda lehekülgede nimekirja
        await loadPages();
      } else {
        setRestoreMessage({ text: `${t('manage.trash.restoreError')}: ${data.detail || data.message || ''}`, ok: false });
      }
    } catch {
      setRestoreMessage({ text: t('manage.trash.restoreError'), ok: false });
    } finally {
      setRestoringPage(null);
    }
  };

  const handleDeleteWork = async () => {
    if (!workId || !authToken) return;
    setDeletingWork(true);
    setDeleteWorkError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}?token=${authToken}`,
        { method: 'DELETE', timeout: 15000 }
      );
      if (res.ok) {
        navigate('/');
      } else {
        setDeleteWorkError(t('management.deleteWorkError'));
      }
    } catch {
      setDeleteWorkError(t('management.deleteWorkError'));
    } finally {
      setDeletingWork(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'Valmis': return 'bg-green-100 text-green-700';
      case 'Kontrollitud': return 'bg-blue-100 text-blue-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center mt-24">
          <p className="text-gray-500">{t('common:errors.notLoggedIn', 'Logi sisse')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Navigatsioon tagasi */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(`/work/${workId}/1`)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={16} />
            {t('manage.backToWork')}
          </button>
        </div>

        {/* Pealkiri */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Wrench size={20} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{t('manage.title')}</h1>
            {workTitle && (
              <p className="text-sm text-gray-500 mt-0.5">{workTitle}</p>
            )}
          </div>
        </div>

        {/* Tabid */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('pages')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'pages'
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('manage.tabPages')}
            {pages.length > 0 && (
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                {pages.length}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setActiveTab('trash');
              if (!trashLoaded) loadTrashPages();
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === 'trash'
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('manage.tabTrash')}
            {trashLoaded && trashPages.length > 0 && (
              <span className="ml-1.5 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
                {trashPages.length}
              </span>
            )}
          </button>
        </div>

        {/* TAB: Leheküljed */}
        {activeTab === 'pages' && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{t('manage.pages')}</h2>
              <div className="flex items-center gap-3">
                {hasReorderChanges && (
                  <button
                    onClick={handleReorderSave}
                    disabled={reorderSaving}
                    className="flex items-center gap-1.5 px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded transition-colors"
                  >
                    {reorderSaving ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpDown size={13} />}
                    {t('manage.reorderSave')}
                  </button>
                )}
                <span className="text-sm text-gray-500">{pages.length} {t('manage.pagesCount', { count: pages.length })}</span>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 size={24} className="animate-spin mr-2" />
                <span>{t('common:labels.loading')}</span>
              </div>
            ) : loadError ? (
              <div className="flex items-center gap-2 p-5 text-red-600">
                <AlertTriangle size={16} />
                <span className="text-sm">{loadError}</span>
              </div>
            ) : pages.length === 0 ? (
              <p className="p-5 text-sm text-gray-400">{t('manage.noPages')}</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {pages.map((page) => (
                  <div key={page.page_num} className="flex items-center gap-3 px-5 py-3">
                    {/* Pisipilt */}
                    <div className="w-10 h-14 bg-gray-100 rounded overflow-hidden flex-shrink-0 border border-gray-200 flex items-center justify-center">
                      <img
                        src={`${IMAGE_BASE_URL}/${workId}/_thumbs/_thumb_${page.lehekylje_pilt.split('/').pop()}`}
                        alt={`Lk ${page.page_num}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-300"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
                          }
                        }}
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">
                          {t('navigation.page')} {page.page_num}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${statusColor(page.status)}`}>
                          {page.status}
                        </span>
                        {!page.has_text && (
                          <span className="text-xs text-gray-400 italic">tühi</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate font-mono mt-0.5">{page.filename}</p>
                    </div>

                    {/* Järjekorranumber */}
                    <input
                      type="number"
                      min={1}
                      max={pages.length}
                      value={draftPositions[page.filename] ?? page.page_num}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(pages.length, Number(e.target.value)));
                        setDraftPositions(prev => ({ ...prev, [page.filename]: v }));
                      }}
                      className={`w-14 text-sm text-center border rounded px-1 py-0.5 ${
                        draftPositions[page.filename] !== page.page_num
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-gray-300'
                      }`}
                    />

                    {/* Kustuta nupp */}
                    <button
                      onClick={() => handleDeletePage(page.page_num)}
                      disabled={deletingPage === page.page_num}
                      className="flex-shrink-0 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                      title={t('manage.deletePage')}
                    >
                      {deletingPage === page.page_num ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {reorderError && (
              <div className="mx-5 mb-2 mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {reorderError}
              </div>
            )}

            {deletePageError && (
              <div className="mx-5 mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {deletePageError}
              </div>
            )}

            {/* Lisa leht */}
            <div className="px-5 py-4 border-t border-gray-100">
              {!showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded transition-colors"
                >
                  <Plus size={15} />
                  {t('manage.addPage')}
                </button>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700">{t('manage.addPageTitle')}</h3>

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t('manage.addPageFile')}</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      onChange={(e) => setAddFile(e.target.files?.[0] || null)}
                      className="text-sm text-gray-700"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 block mb-1">{t('manage.addPagePosition')}</label>
                    <select
                      value={addAfterPage}
                      onChange={(e) => setAddAfterPage(Number(e.target.value))}
                      className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                    >
                      <option value={0}>{t('manage.addPageToBeginning')}</option>
                      {pages.map((p) => (
                        <option key={p.page_num} value={p.page_num}>
                          {t('manage.addPageAfter', { num: p.page_num })}
                        </option>
                      ))}
                      <option value={-1}>{t('manage.addPageToEnd')}</option>
                    </select>
                  </div>

                  {addPageError && (
                    <p className="text-sm text-red-600">{addPageError}</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleAddPage}
                      disabled={!addFile || addingPage}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white rounded transition-colors"
                    >
                      {addingPage ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                      {t('manage.addPageSubmit')}
                    </button>
                    <button
                      onClick={() => { setShowAddForm(false); setAddFile(null); setAddPageError(null); }}
                      className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
                    >
                      {t('common:buttons.cancel', 'Tühista')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: Prügikast */}
        {activeTab === 'trash' && (
          <>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">{t('manage.tabTrash')}</h2>
              <button
                onClick={loadTrashPages}
                disabled={trashLoading}
                className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded text-gray-600 flex items-center gap-1"
              >
                {trashLoading ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                {t('manage.trash.load')}
              </button>
            </div>

            {restoreMessage && (
              <div className={`mx-5 mt-4 p-3 rounded text-sm border ${
                restoreMessage.ok
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}>
                {restoreMessage.text}
              </div>
            )}

            {trashError && (
              <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {trashError}
              </div>
            )}

            {trashLoading && (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 size={24} className="animate-spin mr-2" />
                <span>{t('common:labels.loading')}</span>
              </div>
            )}

            {!trashLoading && trashLoaded && trashPages.length === 0 && (
              <p className="p-5 text-sm text-gray-400">{t('manage.trash.empty')}</p>
            )}

            {!trashLoading && trashPages.length > 0 && (
              <div className="divide-y divide-gray-100">
                {trashPages.map((page) => (
                  <div key={page.filename} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-shrink-0 text-gray-300">
                      <FileImage size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 font-mono">{page.filename}</p>
                      {page.deleted_at && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {t('manage.trash.deletedAt')}: {new Date(page.deleted_at).toLocaleString('et-EE', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                          {page.deleted_by && ` · ${page.deleted_by}`}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRestorePage(page.filename)}
                      disabled={restoringPage === page.filename}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded transition-colors disabled:opacity-50"
                    >
                      {restoringPage === page.filename ? (
                        <><Loader2 size={13} className="animate-spin" />{t('manage.trash.restoring')}</>
                      ) : (
                        <><RotateCcw size={13} />{t('manage.trash.restore')}</>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!trashLoaded && !trashLoading && !trashError && (
              <div className="p-5 text-center">
                <button
                  onClick={loadTrashPages}
                  className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                >
                  {t('manage.trash.load')}
                </button>
              </div>
            )}
          </div>

          {/* Ohutsoon — prügikasti tabi all */}
          <div className="bg-white rounded-xl border border-red-200 shadow-sm">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-red-100">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="font-semibold text-red-800">{t('manage.dangerZone')}</h2>
          </div>
          <div className="p-5">
            {!deleteWorkConfirm ? (
              <button
                onClick={() => { setDeleteWorkConfirm(true); setDeleteWorkInput(''); }}
                className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors"
              >
                {t('management.deleteWork')}
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded p-4 space-y-3">
                <p className="text-sm text-red-800">
                  {t('management.deleteWorkConfirmMessage', { title: workTitle || workId })}
                </p>
                <input
                  type="text"
                  value={deleteWorkInput}
                  onChange={(e) => setDeleteWorkInput(e.target.value)}
                  placeholder={t('management.deleteWorkInputPlaceholder', { word: t('management.deleteWorkConfirmWord') })}
                  className="w-full px-3 py-2 text-sm border border-red-200 rounded focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  autoFocus
                />
                {deleteWorkError && (
                  <p className="text-sm text-red-600 font-medium">{deleteWorkError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteWork}
                    disabled={deletingWork || deleteWorkInput !== t('management.deleteWorkConfirmWord')}
                    className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {deletingWork ? <Loader2 size={14} className="animate-spin inline" /> : t('management.deleteWorkConfirm')}
                  </button>
                  <button
                    onClick={() => { setDeleteWorkConfirm(false); setDeleteWorkError(null); setDeleteWorkInput(''); }}
                    className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
                  >
                    {t('management.deleteWorkCancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
          </>
        )}

      </div>
    </div>
  );
};

export default WorkManage;
