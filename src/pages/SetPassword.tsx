import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Key, Loader2, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { FILE_API_URL } from '../config';

interface TokenInfo {
  valid: boolean;
  email: string;
  name: string;
  expires_at: string;
}

const SetPassword: React.FC = () => {
  const { t } = useTranslation(['register', 'common']);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(true);

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [createdUsername, setCreatedUsername] = useState('');

  // Valideeri token lehe laadimisel
  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setTokenError(t('setPassword.errors.tokenInvalid'));
        setIsValidating(false);
        return;
      }

      try {
        const response = await fetch(`${FILE_API_URL}/invite/${token}`);
        const data = await response.json();

        if (data.status === 'success' && data.valid) {
          setTokenInfo({
            valid: true,
            email: data.email,
            name: data.name,
            expires_at: data.expires_at
          });
        } else {
          setTokenError(data.message || t('setPassword.errors.tokenInvalid'));
        }
      } catch (e) {
        console.error('Token validation error:', e);
        setTokenError(t('common:errors.connectionFailed'));
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [token, t]);

  const validateForm = (): string | null => {
    if (!password) {
      return t('setPassword.errors.passwordRequired');
    }
    if (password.length < 12) {
      return t('setPassword.errors.passwordTooShort');
    }
    // Lihtsa parooli kontroll - vähemalt 4 erinevat tähemärki
    const uniqueChars = new Set(password).size;
    if (uniqueChars < 4) {
      return t('setPassword.errors.passwordTooSimple');
    }
    // Keela korduvad tähed ja numbrijadad
    const simplePatterns = ['123456789012', '111111111111', 'aaaaaaaaaaaa', 'password1234', 'qwertyuiop12'];
    if (simplePatterns.includes(password.toLowerCase()) || password === password[0].repeat(password.length)) {
      return t('setPassword.errors.passwordTooSimple');
    }
    if (password !== passwordConfirm) {
      return t('setPassword.errors.passwordMismatch');
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
      const response = await fetch(`${FILE_API_URL}/invite/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });

      const data = await response.json();

      if (data.status === 'success') {
        setCreatedUsername(data.username);
        setSubmitStatus('success');
      } else {
        setErrorMessage(data.message || t('setPassword.errors.saveFailed'));
        setSubmitStatus('error');
      }
    } catch (e) {
      console.error('Set password error:', e);
      setErrorMessage(t('common:errors.connectionFailed'));
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Laadimine
  if (isValidating) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-amber-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Vigane token
  if (tokenError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-amber-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('setPassword.errors.tokenInvalid')}</h1>
          <p className="text-gray-600 mb-6">{tokenError}</p>
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

  // Edukas loomine
  if (submitStatus === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-amber-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('setPassword.success')}</h1>
          <p className="text-gray-600 mb-2">
            Sinu kasutajanimi: <strong className="text-primary-700">{createdUsername}</strong>
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Kasuta seda kasutajanime sisselogimisel
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <ArrowLeft size={18} />
            Mine sisselogimise lehele
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-amber-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex justify-between items-center">
          <Link
            to="/"
            className="flex items-center gap-2 text-gray-600 hover:text-primary-700 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">{t('common:app.name')}</span>
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      {/* Form */}
      <main className="max-w-lg mx-auto px-4 py-12">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Key className="w-7 h-7 text-primary-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{t('setPassword.title')}</h1>
            <p className="text-gray-500 mt-1">{t('setPassword.subtitle')}</p>
            {tokenInfo && (
              <p className="text-sm text-primary-600 mt-2">
                Tere tulemast, {tokenInfo.name}!
              </p>
            )}
          </div>

          {/* Veateade */}
          {submitStatus === 'error' && errorMessage && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm">{errorMessage}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Parool */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('setPassword.password')} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">{t('setPassword.passwordHint')}</p>
            </div>

            {/* Kinnita parool */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('setPassword.passwordConfirm')} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPasswordConfirm ? 'text' : 'password'}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPasswordConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
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
                  <Key size={20} />
                  {t('setPassword.submit')}
                </>
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default SetPassword;
