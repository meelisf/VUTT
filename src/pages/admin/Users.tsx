import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Loader2,
  Trash2,
  ChevronLeft
} from 'lucide-react';
import Header from '../../components/Header';
import { FILE_API_URL } from '../../config';
import { useUser } from '../../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';

interface User {
  username: string;
  name: string;
  email: string;
  role: 'contributor' | 'editor' | 'admin';
  created_at: string | null;
}

const UsersPage: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (!userLoading && (!user || user.role !== 'admin')) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  useEffect(() => {
    if (authToken && user?.role === 'admin') {
      loadUsers();
    }
  }, [authToken, user]);

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);

    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({})
      });

      const data = await response.json();

      if (data.status === 'success') {
        setUsers(data.users);
      } else {
        setUsersError(data.message || t('users.loadError'));
      }
    } catch (e) {
      console.error('Load users error:', e);
      setUsersError(t('users.connectionError'));
    } finally {
      setUsersLoading(false);
    }
  };

  const handleRoleChange = async (username: string, newRole: string) => {
    setRoleUpdating(username);
    setUsersError(null);

    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/admin/users/update-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({
          username,
          new_role: newRole
        })
      });

      const data = await response.json();

      if (data.status === 'success') {
        setUsers(users.map(u =>
          u.username === username
            ? { ...u, role: newRole as User['role'] }
            : u
        ));
      } else {
        setUsersError(data.message || t('users.roleChangeError'));
      }
    } catch (e) {
      console.error('Role change error:', e);
      setUsersError(t('users.connectionError'));
    } finally {
      setRoleUpdating(null);
    }
  };

  const handleDeleteUser = async (username: string) => {
    setDeleteConfirm(null);
    setRoleUpdating(username);
    setUsersError(null);

    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/admin/users/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({
          username
        })
      });

      const data = await response.json();

      if (data.status === 'success') {
        setUsers(users.filter(u => u.username !== username));
      } else {
        setUsersError(data.message || t('users.deleteError'));
      }
    } catch (e) {
      console.error('Delete user error:', e);
      setUsersError(t('users.connectionError'));
    } finally {
      setRoleUpdating(null);
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('et-EE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (user.role !== 'admin') return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('admin:tabs.users')} />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Users size={20} className="text-primary-600" />
            {t('users.title')} ({users.length})
          </h2>

          {usersError && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {usersError}
            </div>
          )}

          {usersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
          ) : users.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              {t('users.empty')}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('users.name')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('users.username')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('users.email')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('users.role')}</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('users.created')}</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">{t('users.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {users.map((u) => {
                    const isCurrentUser = u.username === user?.username;
                    const isProcessing = roleUpdating === u.username;

                    return (
                      <tr key={u.username} className={`hover:bg-gray-50 ${isCurrentUser ? 'bg-primary-50' : ''}`}>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          <div className="flex items-center gap-2">
                            {u.name}
                            {isCurrentUser && (
                              <span className="text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">
                                {t('users.you')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 font-mono">{u.username}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{u.email || '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          {isCurrentUser ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">
                              {t(`common:roles.${u.role}`)}
                            </span>
                          ) : (
                            <select
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.username, e.target.value)}
                              disabled={isProcessing}
                              className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                            >
                              <option value="contributor">{t('common:roles.contributor')}</option>
                              <option value="editor">{t('common:roles.editor')}</option>
                              <option value="admin">{t('common:roles.admin')}</option>
                            </select>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {u.created_at ? formatDate(u.created_at) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-right">
                          {isCurrentUser ? (
                            <span className="text-gray-400">-</span>
                          ) : deleteConfirm === u.username ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs text-red-600">{t('users.confirmDelete')}</span>
                              <button
                                onClick={() => handleDeleteUser(u.username)}
                                disabled={isProcessing}
                                className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-50"
                              >
                                {isProcessing ? <Loader2 size={12} className="animate-spin" /> : t('users.yes')}
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                disabled={isProcessing}
                                className="px-2 py-1 bg-gray-300 text-gray-700 rounded text-xs hover:bg-gray-400 disabled:opacity-50"
                              >
                                {t('users.no')}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(u.username)}
                              disabled={isProcessing}
                              className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                              title={t('users.delete')}
                            >
                              {isProcessing ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <Trash2 size={16} />
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default UsersPage;
