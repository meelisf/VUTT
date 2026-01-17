import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Users,
  UserPlus,
  FileEdit,
  Check,
  X,
  Loader2,
  Copy,
  CheckCircle,
  Clock,
  Building,
  Mail,
  MessageSquare,
  LogOut,
  Settings,
  ChevronDown,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { FILE_API_URL } from '../config';
import { useUser } from '../contexts/UserContext';

interface Registration {
  id: string;
  name: string;
  email: string;
  affiliation: string | null;
  motivation: string;
  submitted_at: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface InviteResult {
  invite_url: string;
  invite_token: string;
  expires_at: string;
  email: string;
  name: string;
}

interface User {
  username: string;
  name: string;
  email: string;
  role: 'contributor' | 'editor' | 'admin';
  created_at: string | null;
}

const Admin: React.FC = () => {
  const { t } = useTranslation(['admin', 'common', 'auth']);
  const { user, authToken, logout, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'registrations' | 'users'>('registrations');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Kinnitamise tulemus (invite link)
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Töötlemise staatus
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Kasutajate haldus
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Kontrolli ligipääsu
  useEffect(() => {
    if (!userLoading && (!user || user.role !== 'admin')) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  // Lae taotlused
  useEffect(() => {
    if (authToken && user?.role === 'admin') {
      loadRegistrations();
    }
  }, [authToken, user]);

  // Lae kasutajad kui Users tab on aktiivne
  useEffect(() => {
    if (activeTab === 'users' && authToken && user?.role === 'admin' && users.length === 0) {
      loadUsers();
    }
  }, [activeTab, authToken, user]);

  const loadRegistrations = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${FILE_API_URL}/admin/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: authToken })
      });

      const data = await response.json();

      if (data.status === 'success') {
        setRegistrations(data.registrations);
      } else {
        setError(data.message || 'Viga taotluste laadimisel');
      }
    } catch (e) {
      console.error('Load registrations error:', e);
      setError('Serveriga ühendamine ebaõnnestus');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (regId: string) => {
    setProcessingId(regId);
    setInviteResult(null);

    try {
      const response = await fetch(`${FILE_API_URL}/admin/registrations/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          registration_id: regId
        })
      });

      const data = await response.json();

      if (data.status === 'success') {
        // Näita invite linki
        setInviteResult({
          invite_url: data.invite_url,
          invite_token: data.invite_token,
          expires_at: data.expires_at,
          email: data.email,
          name: data.name
        });
        // Lae nimekiri uuesti
        await loadRegistrations();
      } else {
        setError(data.message || 'Kinnitamine ebaõnnestus');
      }
    } catch (e) {
      console.error('Approve error:', e);
      setError('Serveriga ühendamine ebaõnnestus');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (regId: string) => {
    setProcessingId(regId);

    try {
      const response = await fetch(`${FILE_API_URL}/admin/registrations/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          registration_id: regId
        })
      });

      const data = await response.json();

      if (data.status === 'success') {
        await loadRegistrations();
      } else {
        setError(data.message || 'Tagasilükkamine ebaõnnestus');
      }
    } catch (e) {
      console.error('Reject error:', e);
      setError('Serveriga ühendamine ebaõnnestus');
    } finally {
      setProcessingId(null);
    }
  };

  const copyInviteLink = () => {
    if (inviteResult) {
      const fullUrl = `${window.location.origin}${inviteResult.invite_url}`;
      navigator.clipboard.writeText(fullUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  // =========================================================
  // KASUTAJATE HALDUS
  // =========================================================

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);

    try {
      const response = await fetch(`${FILE_API_URL}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: authToken })
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
      const response = await fetch(`${FILE_API_URL}/admin/users/update-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          username,
          new_role: newRole
        })
      });

      const data = await response.json();

      if (data.status === 'success') {
        // Uuenda kohalikku listi
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
      const response = await fetch(`${FILE_API_URL}/admin/users/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: authToken,
          username
        })
      });

      const data = await response.json();

      if (data.status === 'success') {
        // Eemalda kohalikust listist
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

  // Ootel taotlused
  const pendingRegistrations = registrations.filter(r => r.status === 'pending');
  // Käsitletud taotlused
  const processedRegistrations = registrations.filter(r => r.status !== 'pending');

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-y-auto">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <Link to="/" className="hover:opacity-80 transition-opacity flex items-center gap-3">
          <img src="/logo.png" alt="VUTT Logo" className="h-10 w-auto" />
          <div>
            <h1 className="text-2xl font-bold text-primary-900 tracking-tight leading-none">{t('common:app.name')}</h1>
            <p className="text-xs text-gray-500 font-medium tracking-wide uppercase leading-none mt-0.5">{t('common:app.subtitle')}</p>
          </div>
        </Link>
        <div className="flex items-center gap-4">
          {/* Kasutaja rippmenüü */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 hover:bg-gray-100 rounded-lg px-2 py-1 transition-colors"
            >
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-500">{t(`common:roles.${user.role}`)}</p>
              </div>
              <div className="h-9 w-9 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold border-2 border-primary-200 text-sm">
                {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <ChevronDown size={16} className={`text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
            </button>

            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-48 z-50">
                  <div className="sm:hidden px-4 py-2 border-b border-gray-100">
                    <p className="font-medium text-gray-900">{user.name}</p>
                    <p className="text-xs text-gray-500">{t(`common:roles.${user.role}`)}</p>
                  </div>

                  <Link
                    to="/review"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <FileEdit size={16} />
                    {t('common:nav.review')}
                  </Link>

                  <Link
                    to="/admin"
                    onClick={() => setShowUserMenu(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <Settings size={16} />
                    {t('common:nav.admin')}
                  </Link>

                  <div className="border-t border-gray-100 my-1" />

                  <button
                    onClick={() => { setShowUserMenu(false); logout(); }}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                  >
                    <LogOut size={16} />
                    {t('auth:login.logout')}
                  </button>
                </div>
              </>
            )}
          </div>
          <LanguageSwitcher />
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4">
          <nav className="flex gap-4">
            <button
              onClick={() => setActiveTab('registrations')}
              className={`py-3 px-4 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                activeTab === 'registrations'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <UserPlus size={18} />
              {t('tabs.registrations')}
              {pendingRegistrations.length > 0 && (
                <span className="bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full text-xs">
                  {pendingRegistrations.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`py-3 px-4 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                activeTab === 'users'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Users size={18} />
              {t('tabs.users')}
            </button>
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-6 pb-20">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Invite link modal */}
        {inviteResult && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-green-800">{t('registrations.inviteLinkGenerated')}</h3>
                <p className="text-sm text-green-700 mt-1">
                  {inviteResult.name} ({inviteResult.email})
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 bg-white px-3 py-2 rounded border border-green-300 text-sm text-gray-800 overflow-x-auto">
                    {window.location.origin}{inviteResult.invite_url}
                  </code>
                  <button
                    onClick={copyInviteLink}
                    className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center gap-1"
                  >
                    {linkCopied ? <CheckCircle size={16} /> : <Copy size={16} />}
                    {linkCopied ? t('registrations.linkCopied') : t('registrations.copyLink')}
                  </button>
                </div>
                <p className="text-xs text-green-600 mt-2">
                  Aegub: {formatDate(inviteResult.expires_at)}
                </p>
              </div>
              <button
                onClick={() => setInviteResult(null)}
                className="text-green-600 hover:text-green-800"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'registrations' && (
          <div className="space-y-6">
            {/* Ootel taotlused */}
            <section>
              <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Clock size={20} className="text-amber-500" />
                {t('registrations.title')} ({pendingRegistrations.length})
              </h2>

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                </div>
              ) : pendingRegistrations.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
                  {t('registrations.empty')}
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingRegistrations.map((reg) => (
                    <div key={reg.id} className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900 text-lg">{reg.name}</h3>
                          <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                              <Mail size={14} />
                              {reg.email}
                            </span>
                            {reg.affiliation && (
                              <span className="flex items-center gap-1">
                                <Building size={14} />
                                {reg.affiliation}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock size={14} />
                              {formatDate(reg.submitted_at)}
                            </span>
                          </div>
                          <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                            <div className="flex items-start gap-2">
                              <MessageSquare size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                              <p className="text-sm text-gray-700">{reg.motivation}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => handleApprove(reg.id)}
                            disabled={processingId === reg.id}
                            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-400 transition-colors flex items-center gap-1"
                          >
                            {processingId === reg.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Check size={16} />
                            )}
                            {t('registrations.approve')}
                          </button>
                          <button
                            onClick={() => handleReject(reg.id)}
                            disabled={processingId === reg.id}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-red-400 transition-colors flex items-center gap-1"
                          >
                            {processingId === reg.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <X size={16} />
                            )}
                            {t('registrations.reject')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Käsitletud taotlused */}
            {processedRegistrations.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">
                  Käsitletud taotlused ({processedRegistrations.length})
                </h2>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('registrations.name')}</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('registrations.email')}</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('registrations.submitted')}</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Staatus</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {processedRegistrations.map((reg) => (
                        <tr key={reg.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">{reg.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{reg.email}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatDate(reg.submitted_at)}</td>
                          <td className="px-4 py-3">
                            {reg.status === 'approved' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                                <Check size={12} />
                                {t('registrations.approved')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                                <X size={12} />
                                {t('registrations.rejected')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'users' && (
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
        )}

      </main>
    </div>
  );
};

export default Admin;
