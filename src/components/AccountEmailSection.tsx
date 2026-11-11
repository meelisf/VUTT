import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FILE_API_URL } from '../config';
import { ApiError, apiGet, apiPost } from '../services/apiClient';
import { useNotify } from '../contexts/FeedbackContext';

/** Serveri veakood → tõlkevõti. Tundmatu kood = üldine viga. */
export function emailErrorKey(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = (e.data as { detail?: unknown } | null)?.detail;
    if (e.status === 429) return 'account.email.errors.locked';
    if (detail === 'wrong_password') return 'account.email.errors.wrongPassword';
    if (detail === 'invalid_email') return 'account.email.errors.invalid';
    if (detail === 'email_taken') return 'account.email.errors.taken';
  }
  return 'account.email.errors.failed';
}

/**
 * Oma e-posti muutmine (#786 kõrvalleid). E-post on parooli taastamise kanal,
 * seega nõuab server praegust parooli — varastatud sessiooniga vahetus annaks
 * konto üle. Parooliväli tühjendatakse pärast iga katset.
 */
const AccountEmailSection: React.FC<{ token: string | null }> = ({ token }) => {
  const { t } = useTranslation(['settings']);
  const notify = useNotify();
  const [current, setCurrent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiGet<{ email: string }>(`${FILE_API_URL}/account`, { token })
      .then(d => { if (alive) setCurrent(d.email || ''); })
      .catch(() => { if (alive) setCurrent(null); });
    return () => { alive = false; };
  }, [token]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const d = await apiPost<{ email: string }>(`${FILE_API_URL}/account/email`, { email, password }, { token });
      setCurrent(d.email);
      setEditing(false);
      notify(t('account.email.saved'), 'success');
    } catch (err) {
      setError(t(emailErrorKey(err)));
    } finally {
      setPassword('');
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-sm font-medium text-gray-900 mb-1">{t('account.email.label')}</p>
      <p className="text-xs text-gray-500 mb-3">{t('account.email.description')}</p>
      {!editing ? (
        <div className="flex items-center justify-between gap-3">
          <span className={`text-sm ${current ? 'text-gray-900' : 'text-gray-500 italic'}`}>
            {current === null ? '…' : current || t('account.email.none')}
          </span>
          <button
            type="button"
            onClick={() => { setEditing(true); setEmail(current ?? ''); setError(null); }}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            {t('account.email.change')}
          </button>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <label className="block">
            <span className="text-xs text-gray-600">{t('account.email.newLabel')}</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-600">{t('account.email.passwordLabel')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </label>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {t('account.email.save')}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setPassword(''); setError(null); }}
              className="px-4 py-2 rounded-md text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              {t('account.email.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default AccountEmailSection;
