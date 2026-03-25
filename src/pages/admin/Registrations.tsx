import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  UserPlus,
  Check,
  X,
  Loader2,
  Copy,
  CheckCircle,
  Clock,
  Building,
  Mail,
  MessageSquare,
  ChevronLeft
} from 'lucide-react';
import Header from '../../components/Header';
import { FILE_API_URL } from '../../config';
import { useUser } from '../../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';

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

const Registrations: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (!userLoading && (!user || user.role !== 'admin')) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  useEffect(() => {
    if (authToken && user?.role === 'admin') {
      loadRegistrations();
    }
  }, [authToken, user]);

  const loadRegistrations = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/admin/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({})
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
      const response = await fetchWithTimeout(`${FILE_API_URL}/admin/registrations/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({
          registration_id: regId
        })
      });

      const data = await response.json();

      if (data.status === 'success') {
        setInviteResult({
          invite_url: data.invite_url,
          invite_token: data.invite_token,
          expires_at: data.expires_at,
          email: data.email,
          name: data.name
        });
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
      const response = await fetchWithTimeout(`${FILE_API_URL}/admin/registrations/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({
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

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString('et-EE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const pendingRegistrations = registrations.filter(r => r.status === 'pending');
  const processedRegistrations = registrations.filter(r => r.status !== 'pending');

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
      <Header showSearchButton={false} pageTitle={t('admin:tabs.registrations')} />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

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
                  <a
                    href={(() => {
                      const fullUrl = `${window.location.origin}${inviteResult.invite_url}`;
                      const subject = encodeURIComponent('VUTT – konto aktiveerimise link');
                      const body = encodeURIComponent(
                        `Tere ${inviteResult.name},\n\n` +
                        `Teie juurdepääsutaotlus VUTT platvormile on kinnitatud.\n\n` +
                        `Palun seadistage oma parool alloleva lingi kaudu (link kehtib 48 tundi):\n` +
                        `${fullUrl}\n\n` +
                        `Lugupidamisega,\nVUTT meeskonna nimel`
                      );
                      return `mailto:${inviteResult.email}?subject=${subject}&body=${body}`;
                    })()}
                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-1"
                  >
                    <Mail size={16} />
                    {t('registrations.sendEmail')}
                  </a>
                </div>
                <p className="text-xs text-green-600 mt-2">
                  {t('registrations.expires')}: {formatDate(inviteResult.expires_at)}
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
                {t('registrations.processed')} ({processedRegistrations.length})
              </h2>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('registrations.name')}</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('registrations.email')}</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('registrations.submitted')}</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">{t('registrations.status')}</th>
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

        {/* Uuenda nupp */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={loadRegistrations}
            disabled={isLoading}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            {t('common:actions.refresh')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Registrations;
