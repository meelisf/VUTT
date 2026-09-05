import React, { useState, useEffect } from 'react';
import { isAtLeast } from '../../utils/roleUtils';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCollection } from '../../contexts/CollectionContext';
import { getWritableCollectionOptions } from '../../services/collectionService';
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
import { useUser } from '../../contexts/UserContext';
import { apiPost } from '../../services/apiClient';

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
  language?: 'et' | 'en';
}

interface InviteResult {
  invite_url: string;
  invite_token: string;
  expires_at: string;
  email: string;
  username?: string;
  name: string;
  // Optional: vana kujuga serveri vastuses (frontend deployitud enne backendit)
  // need väljad puuduvad — vt kaitset mailto-nupu renderdamisel.
  mail_subject?: string;
  mail_body?: string;
  // Serveri ehitatud täisaadress (PUBLIC_BASE_URL + invite_url) — sama allikas,
  // mida kasutab ka kirja tekst. Puudub vana backendi vastuses (frontend
  // deployitud enne backendit); sel juhul langeb kuvamine/kopeerimine tagasi
  // window.location.origin põhisele arvutusele (vt fullInviteUrl).
  invite_absolute_url?: string;
}

interface RegistrationsResponse {
  status: 'success' | 'error';
  registrations?: Registration[];
  message?: string;
}

interface RegistrationActionResponse extends InviteResult {
  status: 'success' | 'error';
  message?: string;
}

const Registrations: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken, isLoading: userLoading } = useUser();
  const { collections } = useCollection();
  const navigate = useNavigate();

  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Rolli ja ulatuse valik on taotluse ID järgi eraldi seisund (mitte üks jagatud
  // muutuja) — taotlusi kuvatakse mitu korraga ning jagatud seisund laseks adminil
  // kinnitada VALE rolli/ulatuse, kui ta valib ühel real ja vajutab kinnita teisel.
  const [approveRole, setApproveRole] = useState<Record<string, 'editor' | 'contributor'>>({});
  const [approveScope, setApproveScope] = useState<Record<string, string[]>>({});
  const [approveLanguage, setApproveLanguage] = useState<Record<string, 'et' | 'en'>>({});
  const roleFor = (regId: string): 'editor' | 'contributor' => approveRole[regId] || 'editor';
  const scopeFor = (regId: string): string[] => approveScope[regId] || [];
  // Võtab regId (mitte Registration objekti) — kutsekohas ei pea taotlust uuesti
  // otsima ega `as`-iga eeldama, et otsing õnnestus (taotlus võib olla vahepeal
  // nimekirjast kadunud, kui teine admin jõudis ette).
  const languageFor = (regId: string): 'et' | 'en' => {
    if (approveLanguage[regId]) return approveLanguage[regId];
    const reg = registrations.find((r) => r.id === regId);
    return reg?.language || 'et';
  };

  // KÕIK kollektsioonid, mitte ainult restricted: kirjutamisulatus kehtib ka
  // avalikele kogudele (erinevalt allowed_collections'ist, mis mõjutab ainult
  // piiratud kogusid). virtual_group on välja jäetud (vt getWritableCollectionOptions).
  const allCollections = React.useMemo(
    () => getWritableCollectionOptions(collections),
    [collections]
  );

  useEffect(() => {
    if (!userLoading && (!user || !isAtLeast(user.role, 'admin'))) {
      navigate('/');
    }
  }, [user, userLoading, navigate]);

  useEffect(() => {
    if (authToken && isAtLeast(user?.role, 'admin')) {
      loadRegistrations();
    }
  }, [authToken, user]);

  const loadRegistrations = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiPost<RegistrationsResponse>('/admin/registrations', {}, { token: authToken });

      if (data.status === 'success') {
        setRegistrations(data.registrations || []);
      } else {
        setError(data.message || t('registrations.loadError'));
      }
    } catch (e) {
      console.error('Load registrations error:', e);
      setError(t('common:errors.connectionFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (regId: string) => {
    setProcessingId(regId);
    setInviteResult(null);

    const role = roleFor(regId);
    const scope = role === 'contributor' ? scopeFor(regId) : [];

    try {
      const data = await apiPost<RegistrationActionResponse>('/admin/registrations/approve', {
        registration_id: regId,
        role,
        edit_collections: scope,
        language: languageFor(regId)
      }, { token: authToken });

      if (data.status === 'success') {
        setInviteResult({
          invite_url: data.invite_url,
          invite_token: data.invite_token,
          expires_at: data.expires_at,
          email: data.email,
          username: data.username,
          name: data.name,
          mail_subject: data.mail_subject,
          mail_body: data.mail_body,
          invite_absolute_url: data.invite_absolute_url
        });
        // Käsitletud taotluse valik ei ole enam vajalik — koorista, et Record ei kasvaks lõputult.
        setApproveRole((prev) => { const next = { ...prev }; delete next[regId]; return next; });
        setApproveScope((prev) => { const next = { ...prev }; delete next[regId]; return next; });
        setApproveLanguage((prev) => { const next = { ...prev }; delete next[regId]; return next; });
        await loadRegistrations();
      } else {
        setError(data.message || t('registrations.approveError'));
      }
    } catch (e) {
      console.error('Approve error:', e);
      setError(t('common:errors.connectionFailed'));
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (regId: string) => {
    setProcessingId(regId);

    try {
      const data = await apiPost<RegistrationActionResponse>('/admin/registrations/reject', {
        registration_id: regId
      }, { token: authToken });

      if (data.status === 'success') {
        await loadRegistrations();
      } else {
        setError(data.message || t('registrations.rejectError'));
      }
    } catch (e) {
      console.error('Reject error:', e);
      setError(t('common:errors.connectionFailed'));
    } finally {
      setProcessingId(null);
    }
  };

  // Kuvatava ja kopeeritava lingi allikas: ÜKS koht, sama väärtus, mida
  // server kirja sisse kirjutas (PUBLIC_BASE_URL + invite_url). Vana backend
  // ei tagasta invite_absolute_url't — sel juhul on window.location.origin
  // sobiv varulahendus, sest see on kuvamis-, mitte kirjatekstiallikas.
  const fullInviteUrl = (result: InviteResult) =>
    result.invite_absolute_url || `${window.location.origin}${result.invite_url}`;

  const copyInviteLink = () => {
    if (inviteResult) {
      navigator.clipboard.writeText(fullInviteUrl(inviteResult));
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

  if (!isAtLeast(user.role, 'admin')) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('admin:tabs.registrations')} />
      <div className="max-w-5xl mx-auto px-4 py-8">
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
                {inviteResult.username && (
                  <p className="text-sm text-green-800 mt-1">
                    {t('users.username')}: <span className="font-semibold">{inviteResult.username}</span>
                  </p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <code className="flex-1 bg-white px-3 py-2 rounded border border-green-300 text-sm text-gray-800 overflow-x-auto">
                    {fullInviteUrl(inviteResult)}
                  </code>
                  <button
                    onClick={copyInviteLink}
                    className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center gap-1"
                  >
                    {linkCopied ? <CheckCircle size={16} /> : <Copy size={16} />}
                    {linkCopied ? t('registrations.linkCopied') : t('registrations.copyLink')}
                  </button>
                  {inviteResult.mail_subject && inviteResult.mail_body ? (
                    <a
                      href={`mailto:${inviteResult.email}?subject=${encodeURIComponent(inviteResult.mail_subject)}&body=${encodeURIComponent(inviteResult.mail_body)}`}
                      className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-1"
                    >
                      <Mail size={16} />
                      {t('registrations.sendEmail')}
                    </a>
                  ) : null}
                </div>
                {/* Kirjamall puudub vana kujuga serveri vastuses (frontend deployitud enne backendit) —
                    näita seda selgesõnaliselt, mitte vaikimisi tühja/undefined-tekstiga kirja. */}
                {!(inviteResult.mail_subject && inviteResult.mail_body) && (
                  <p className="text-xs text-amber-700 mt-2">{t('registrations.mailTemplateMissing')}</p>
                )}
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

                        <div className="flex flex-col gap-2 mt-3">
                          <label className="text-xs font-medium text-gray-500">{t('registrations.roleLabel')}</label>
                          <select
                            value={roleFor(reg.id)}
                            onChange={(e) =>
                              setApproveRole((prev) => ({ ...prev, [reg.id]: e.target.value as 'editor' | 'contributor' }))
                            }
                            className="text-sm border border-gray-300 rounded px-2 py-1 w-fit"
                          >
                            <option value="editor">{t('registrations.roleEditor')}</option>
                            <option value="contributor">{t('registrations.roleContributor')}</option>
                          </select>

                          <label className="text-xs font-medium text-gray-500">{t('registrations.languageLabel')}</label>
                          <select
                            value={languageFor(reg.id)}
                            onChange={(e) =>
                              setApproveLanguage((prev) => ({ ...prev, [reg.id]: e.target.value as 'et' | 'en' }))
                            }
                            className="text-sm border border-gray-300 rounded px-2 py-1 w-fit"
                          >
                            <option value="et">{t('registrations.languageEt')}</option>
                            <option value="en">{t('registrations.languageEn')}</option>
                          </select>

                          {roleFor(reg.id) === 'contributor' && (
                            <div>
                              <span className="text-xs font-medium text-gray-500">{t('registrations.editCollections')}</span>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {allCollections.map((c) => (
                                  <label key={c.id} className="flex items-center gap-1 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={scopeFor(reg.id).includes(c.id)}
                                      onChange={(e) =>
                                        setApproveScope((prev) => {
                                          const cur = prev[reg.id] || [];
                                          const next = e.target.checked
                                            ? [...cur, c.id]
                                            : cur.filter((x) => x !== c.id);
                                          return { ...prev, [reg.id]: next };
                                        })
                                      }
                                    />
                                    {c.name}
                                  </label>
                                ))}
                              </div>
                              {scopeFor(reg.id).length === 0 && (
                                <p className="text-xs text-amber-700 mt-1">{t('registrations.editCollectionsNone')}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleApprove(reg.id)}
                          disabled={processingId === reg.id || (roleFor(reg.id) === 'contributor' && scopeFor(reg.id).length === 0)}
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
              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[480px]">
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
            {t('common:buttons.refresh')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Registrations;
