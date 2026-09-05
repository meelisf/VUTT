import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { UserPlus, Loader2, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import Header from '../components/Header';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { deriveUsernameFromEmail } from '../utils/username';
import { defaultRegistrationLanguage, UiLanguage } from './registerLanguage';

const Register: React.FC = () => {
  const { t, i18n } = useTranslation(['register', 'common']);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    affiliation: '',
    motivation: '',
    website: ''  // Honeypot väli - botid täidavad, inimesed ei näe
  });
  const [gdprConsent, setGdprConsent] = useState(false);
  const [language, setLanguage] = useState<UiLanguage>(defaultRegistrationLanguage(i18n.language));

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const fallbackUsernamePreview = useMemo(() => deriveUsernameFromEmail(formData.email), [formData.email]);
  const [serverUsernamePreview, setServerUsernamePreview] = useState('');
  const usernamePreview = serverUsernamePreview || fallbackUsernamePreview;

  useEffect(() => {
    const email = formData.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setServerUsernamePreview('');
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetchWithTimeout(`${FILE_API_URL}/register/username-preview?email=${encodeURIComponent(email)}`, {
          timeout: 5000
        });
        const data = await response.json();
        if (!cancelled && data.status === 'success') {
          setServerUsernamePreview(data.username || '');
        }
      } catch {
        if (!cancelled) setServerUsernamePreview('');
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [formData.email]);

  const validateForm = (): string | null => {
    if (!formData.name.trim()) {
      return t('errors.nameRequired');
    }
    if (!formData.email.trim()) {
      return t('errors.emailRequired');
    }
    // Lihtne e-posti valideerimine
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      return t('errors.emailInvalid');
    }
    if (!formData.motivation.trim()) {
      return t('errors.motivationRequired');
    }
    if (!gdprConsent) {
      return t('errors.consentRequired');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setErrorMessage(validationError);
      setSubmitStatus('error');
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');
    setErrorMessage('');

    try {
      const response = await fetchWithTimeout(`${FILE_API_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim().toLowerCase(),
          affiliation: formData.affiliation.trim() || null,
          motivation: formData.motivation.trim(),
          gdpr_consent: true,
          language,
          website: formData.website  // Honeypot
        })
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.status === 'success') {
        setSubmitStatus('success');
      } else {
        setErrorMessage(data.detail || data.message || t('errors.submitFailed'));
        setSubmitStatus('error');
      }
    } catch (error) {
      console.error('Registration error:', error);
      setErrorMessage(t('common:errors.connectionFailed'));
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Edukas esitamine
  if (submitStatus === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-amber-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('success.title')}</h1>
          <p className="text-gray-600 mb-6">{t('success.message')}</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <ArrowLeft size={18} />
            {t('common:buttons.back')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-amber-50 overflow-y-auto">
      <Header />

      {/* Form */}
      <main className="max-w-lg mx-auto px-4 py-12 pb-20">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <UserPlus className="w-7 h-7 text-primary-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-gray-500 mt-1">{t('subtitle')}</p>
          </div>

          <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg space-y-2">
            <p className="text-sm text-blue-800">{t('description')}</p>
            <p className="text-sm text-blue-700 italic">{t('reviewNote')}</p>
          </div>

          {/* Veateade */}
          {submitStatus === 'error' && errorMessage && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm">{errorMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Honeypot - peidetud väli botide püüdmiseks */}
            <div className="absolute -left-[9999px]" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                type="text"
                id="website"
                name="website"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            {/* Nimi */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('form.name')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('form.namePlaceholder')}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
                disabled={isSubmitting}
              />
            </div>

            {/* E-post */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('form.email')} <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder={t('form.emailPlaceholder')}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
                disabled={isSubmitting}
              />
              {usernamePreview && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                  <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                  <span>
                    {t('form.usernamePreview')}{' '}
                    <strong className="font-semibold text-green-900">{usernamePreview}</strong>
                  </span>
                </div>
              )}
            </div>

            {/* Suhtluskeel — vaikimisi UI keel, aga inimene saab muuta:
                eestikeelset lehte sirviv väliskülaline soovib ingliskeelset kirja. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('form.language')}
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as UiLanguage)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
                disabled={isSubmitting}
              >
                <option value="et">{t('form.languageEt')}</option>
                <option value="en">{t('form.languageEn')}</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">{t('form.languageHint')}</p>
            </div>

            {/* Asutus */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('form.affiliation')}
              </label>
              <input
                type="text"
                value={formData.affiliation}
                onChange={(e) => setFormData({ ...formData, affiliation: e.target.value })}
                placeholder={t('form.affiliationPlaceholder')}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
                disabled={isSubmitting}
              />
            </div>

            {/* Motivatsioon */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('form.motivation')} <span className="text-red-500">*</span>
              </label>
              <textarea
                value={formData.motivation}
                onChange={(e) => setFormData({ ...formData, motivation: e.target.value })}
                placeholder={t('form.motivationPlaceholder')}
                rows={4}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors resize-none"
                disabled={isSubmitting}
              />
            </div>

            {/* GDPR nõusolek */}
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="gdpr-consent"
                checked={gdprConsent}
                onChange={(e) => setGdprConsent(e.target.checked)}
                disabled={isSubmitting}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer flex-shrink-0"
              />
              <label htmlFor="gdpr-consent" className="text-sm text-gray-700 cursor-pointer leading-snug">
                {t('gdprConsent.label')} <span className="text-red-500">*</span>
              </label>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:bg-primary-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {t('common:labels.loading')}
                </>
              ) : (
                <>
                  <UserPlus size={20} />
                  {t('form.submit')}
                </>
              )}
            </button>
          </form>

          {/* Login link */}
          <p className="text-center text-sm text-gray-500 mt-6">
            {t('common:buttons.back')}?{' '}
            <Link to="/" className="text-primary-600 hover:text-primary-700 font-medium">
              {t('common:app.name')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default Register;
