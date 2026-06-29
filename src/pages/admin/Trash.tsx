import React, { useState, useEffect } from 'react';
import { isAtLeast } from '../../utils/roleUtils';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  Trash2,
  RefreshCw,
  RotateCcw,
  Image,
  ChevronLeft
} from 'lucide-react';
import Header from '../../components/Header';
import { FILE_API_URL } from '../../config';
import { useUser } from '../../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';

interface DeletedWork {
  work_id: string;
  title: string;
  deleted_at: string | null;
  deleted_by: string | null;
  commit_hash: string | null;
  jpg_count: number;
}

const Trash: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [trashItems, setTrashItems] = useState<DeletedWork[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [isRestoreError, setIsRestoreError] = useState(false);

  useEffect(() => {
    if (!userLoading && (!user || !isAtLeast(user.role, 'admin'))) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  useEffect(() => {
    if (authToken && isAtLeast(user?.role, 'admin') && !trashLoaded) {
      loadTrash();
    }
  }, [authToken, user]);

  const loadTrash = async () => {
    setTrashLoading(true);
    setTrashError(null);
    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/admin/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (data.status === 'success') {
        setTrashItems(data.items);
        setTrashLoaded(true);
      } else {
        setTrashError(t('trash.loadError'));
      }
    } catch {
      setTrashError(t('trash.loadError'));
    } finally {
      setTrashLoading(false);
    }
  };

  const handleRestore = async (workId: string, title: string) => {
    setRestoringId(workId);
    setRestoreMessage(null);
    setIsRestoreError(false);
    try {
      const response = await fetchWithTimeout(
        `${FILE_API_URL}/admin/trash/${workId}/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
          body: JSON.stringify({}),
          timeout: 30000
        }
      );
      const data = await response.json();
      if (data.status === 'success') {
        setRestoreMessage(t('trash.restoreSuccess', { title: data.title || title }));
        setIsRestoreError(false);
        setTrashItems(prev => prev.filter(item => item.work_id !== workId));
      } else {
        setRestoreMessage(`${t('trash.restoreError')}: ${data.detail || data.message || t('common:error.unknown')}`);
        setIsRestoreError(true);
      }
    } catch {
      setRestoreMessage(t('trash.restoreError'));
      setIsRestoreError(true);
    } finally {
      setRestoringId(null);
    }
  };

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!isAtLeast(user.role, 'admin')) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('admin:tabs.trash')} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Trash2 size={20} className="text-gray-500" />
              {t('trash.title')}
            </h2>
            <button
              onClick={() => { setTrashLoaded(false); loadTrash(); }}
              disabled={trashLoading}
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
            >
              {trashLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t('trash.load')}
            </button>
          </div>

          {restoreMessage && (
            <div className={`p-3 rounded-lg text-sm border ${
              isRestoreError
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-green-50 border-green-200 text-green-700'
            }`}>
              {restoreMessage}
            </div>
          )}

          {trashError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {trashError}
            </div>
          )}

          {trashLoading && (
            <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}

          {!trashLoading && trashLoaded && trashItems.length === 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
              {t('trash.empty')}
            </div>
          )}

          {trashItems.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('common:labels.title')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('trash.deletedAt')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('trash.deletedBy')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600"></th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {trashItems.map(item => (
                    <tr key={item.work_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{item.title}</div>
                        <div className="text-xs text-gray-400 font-mono">{item.work_id}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {item.deleted_at
                          ? new Date(item.deleted_at).toLocaleString('et-EE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : t('trash.unknownDate')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {item.deleted_by || t('trash.unknownUser')}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Image size={12} />
                          {t('trash.jpgCount', { count: item.jpg_count })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleRestore(item.work_id, item.title)}
                          disabled={restoringId === item.work_id}
                          className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1 ml-auto"
                        >
                          {restoringId === item.work_id
                            ? <><Loader2 size={12} className="animate-spin" />{t('trash.restoring')}</>
                            : <><RotateCcw size={12} />{t('trash.restore')}</>
                          }
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Trash;
