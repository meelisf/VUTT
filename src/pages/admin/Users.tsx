import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Loader2,
  Trash2,
  ChevronLeft,
  MoreVertical,
  KeyRound,
  Copy,
  CheckCircle,
  X
} from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { apiPost } from '../../services/apiClient';
import { ROLE_LEVELS, canManageUser, assignableRoles, roleLevel } from '../../utils/roleUtils';

interface User {
  username: string;
  name: string;
  email: string;
  role: 'contributor' | 'editor' | 'admin' | 'superadmin';
  created_at: string | null;
  allowed_collections?: string[];
}

interface UsersResponse {
  status: 'success' | 'error';
  users?: User[];
  message?: string;
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
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Ankru-ristkülik portaliga renderdatud menüü/kinnituse positsioneerimiseks.
  // Vajalik, sest tabeli ümbris on overflow-x-auto, mis lõikaks absolute-menüü "nurga taha".
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [resetResult, setResetResult] = useState<{ username: string; name: string; reset_url: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!userLoading && (!user || roleLevel(user.role) < ROLE_LEVELS.admin)) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  useEffect(() => {
    if (authToken && user && roleLevel(user.role) >= ROLE_LEVELS.admin) {
      loadUsers();
    }
  }, [authToken, user]);

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);

    try {
      const data = await apiPost<UsersResponse>('/admin/users', {}, { token: authToken });

      if (data.status === 'success') {
        setUsers(data.users || []);
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
      const data = await apiPost<UsersResponse>('/admin/users/update-role', {
        username,
        new_role: newRole
      }, { token: authToken });

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
      const data = await apiPost<UsersResponse>('/admin/users/delete', {
        username
      }, { token: authToken });

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

  const handleResetPassword = async (username: string) => {
    setOpenMenu(null);
    setRoleUpdating(username);
    setUsersError(null);
    setResetResult(null);
    setLinkCopied(false);
    try {
      const data = await apiPost<{ status: string; reset_url?: string; username?: string; name?: string; message?: string }>(
        '/admin/users/reset-password', { username }, { token: authToken });
      if (data.status === 'success' && data.reset_url) {
        setResetResult({ username: data.username || username, name: data.name || '', reset_url: data.reset_url });
      } else {
        setUsersError(data.message || t('users.resetError'));
      }
    } catch (e) {
      console.error('Reset password error:', e);
      setUsersError(t('users.resetError'));
    } finally {
      setRoleUpdating(null);
    }
  };

  const copyResetLink = () => {
    if (resetResult) {
      navigator.clipboard.writeText(`${window.location.origin}${resetResult.reset_url}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  // Sulge kebab-menüü klõpsul mujale või kerimisel (fixed-positsioon triiviks muidu ankrust eemale)
  useEffect(() => {
    if (!openMenu && !deleteConfirm) return;
    const close = () => { setOpenMenu(null); setDeleteConfirm(null); };
    document.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [openMenu, deleteConfirm]);

  // Arvuta fixed-positsioon ankru järgi: joondu nupu paremasse serva, keera üles kui aken on all otsas
  const popoverStyle = (width: number, estHeight: number): React.CSSProperties => {
    const margin = 8;
    const rect = anchorRect;
    if (!rect) return { display: 'none' };
    let left = rect.right - width;
    if (left < margin) left = margin;
    let top = rect.bottom + 4;
    if (top + estHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - estHeight - 4);
    }
    return { position: 'fixed', top, left, width };
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

  if (roleLevel(user.role) < ROLE_LEVELS.admin) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('admin:tabs.users')} />
      <div className="max-w-5xl mx-auto px-4 py-8">
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

          {resetResult && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-medium text-green-800">{t('users.resetLinkGenerated')}</h3>
                  <p className="text-sm text-green-700 mt-1">
                    {resetResult.name} (<span className="font-mono">{resetResult.username}</span>)
                  </p>
                  <p className="text-xs text-green-700 mt-1">{t('users.resetLinkHint')}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <code className="flex-1 bg-white px-3 py-2 rounded border border-green-300 text-sm text-gray-800 overflow-x-auto">
                      {window.location.origin}{resetResult.reset_url}
                    </code>
                    <button
                      onClick={copyResetLink}
                      className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center gap-1 whitespace-nowrap"
                    >
                      {linkCopied ? <CheckCircle size={16} /> : <Copy size={16} />}
                      {linkCopied ? t('users.linkCopied') : t('users.copyLink')}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => setResetResult(null)}
                  className="text-green-600 hover:text-green-800 flex-shrink-0"
                  title={t('common:buttons.close')}
                  aria-label={t('common:buttons.close')}
                >
                  <X size={18} />
                </button>
              </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {users.map((u) => {
                const isCurrentUser = u.username === user?.username;
                const isProcessing = roleUpdating === u.username;
                const canReset = isCurrentUser || canManageUser(user.role, u.role);
                const canManage = canManageUser(user.role, u.role);
                const canDelete = !isCurrentUser && canManage;

                return (
                  <div
                    key={u.username}
                    className={`relative flex flex-col rounded-lg border p-4 transition-colors ${
                      isCurrentUser ? 'border-primary-300 bg-primary-50' : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    {/* Identiteet: nimi + kasutajanimi + e-post; tegevuste kebab paremas ülanurgas */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 truncate">{u.name}</span>
                          {isCurrentUser && (
                            <span className="flex-shrink-0 text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">
                              {t('users.you')}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-gray-500 truncate">{u.username}</div>
                        <div className="text-sm text-gray-600 truncate">{u.email || '-'}</div>
                      </div>

                      {(canReset || canDelete) && (
                        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={(e) => {
                              setDeleteConfirm(null);
                              if (openMenu === u.username) {
                                setOpenMenu(null);
                              } else {
                                setAnchorRect(e.currentTarget.getBoundingClientRect());
                                setOpenMenu(u.username);
                              }
                            }}
                            disabled={isProcessing}
                            className="p-1 text-gray-500 hover:bg-gray-100 rounded disabled:opacity-50"
                            aria-haspopup="menu"
                            aria-expanded={openMenu === u.username}
                            title={t('users.actionsMenu')}
                          >
                            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <MoreVertical size={16} />}
                          </button>
                          {openMenu === u.username && createPortal(
                            <div
                              role="menu"
                              style={popoverStyle(176, 96)}
                              className="z-50 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-left"
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => { if (e.key === 'Escape') setOpenMenu(null); }}
                            >
                              {canReset && (
                                <button
                                  role="menuitem"
                                  onClick={() => handleResetPassword(u.username)}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                >
                                  <KeyRound size={15} /> {t('users.resetPassword')}
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  role="menuitem"
                                  onClick={() => { setOpenMenu(null); setDeleteConfirm(u.username); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 size={15} /> {t('users.delete')}
                                </button>
                              )}
                            </div>,
                            document.body
                          )}
                          {deleteConfirm === u.username && createPortal(
                            <div
                              style={popoverStyle(224, 96)}
                              className="z-50 w-56 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-left"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <p className="text-xs text-red-600 mb-2">{t('users.confirmDelete')}</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleDeleteUser(u.username)}
                                  disabled={isProcessing}
                                  className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-50"
                                >
                                  {isProcessing ? <Loader2 size={12} className="animate-spin" /> : t('users.yes')}
                                </button>
                                <button
                                  onClick={() => setDeleteConfirm(null)}
                                  className="px-2 py-1 bg-gray-300 text-gray-700 rounded text-xs hover:bg-gray-400"
                                >
                                  {t('users.no')}
                                </button>
                              </div>
                            </div>,
                            document.body
                          )}
                        </div>
                      )}
                    </div>

                    {/* Tähtsad väljad: roll + piiratud kogud */}
                    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                      <div className="flex items-center gap-2">
                        <span className="w-24 flex-shrink-0 text-xs font-medium text-gray-500">{t('users.role')}</span>
                        {isCurrentUser || !canManage ? (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs"
                            title={!isCurrentUser && !canManage ? t('users.noPermissionManage') : undefined}
                          >
                            {t(`common:roles.${u.role}`)}
                          </span>
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.username, e.target.value)}
                            disabled={isProcessing}
                            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                          >
                            {assignableRoles(user.role).map((r) => (
                              <option key={r} value={r}>{t(`common:roles.${r}`)}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-24 flex-shrink-0 text-xs font-medium text-gray-500 mt-1">Piiratud kogud</span>
                        {u.allowed_collections && u.allowed_collections.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {u.allowed_collections.map((c) => (
                              <span key={c} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                                {c}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 mt-0.5">—</span>
                        )}
                      </div>
                    </div>

                    {/* Vähemoluline: loodud-kuupäev */}
                    <div className="mt-3 text-xs text-gray-400">
                      {t('users.created')}: {u.created_at ? formatDate(u.created_at) : '-'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default UsersPage;
