import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { LogIn, Loader2, AlertCircle, UserPlus } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose?: () => void;
  allowClose?: boolean;
  /** Teade, mis kuvatakse vormi kohal (nt sessioon aegunud) */
  message?: string;
}

const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, allowClose = true, message }) => {
  const { t } = useTranslation(['auth', 'common']);
  const { login } = useUser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(username, password);

    setIsLoading(false);

    if (result.success) {
      setUsername('');
      setPassword('');
      onClose?.();
    } else {
      setError(result.error || t('common:errors.loginFailed'));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-primary-600 px-6 py-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <LogIn size={24} />
            {t('login.title')}
          </h2>
          <p className="text-primary-100 text-sm mt-1">{t('common:app.name')} - {t('common:app.subtitle')}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {message && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle size={18} className="text-amber-600 flex-shrink-0" />
              {message}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
              {t('login.username')}
            </label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-200 focus:border-primary-500 outline-none transition-shadow"
              placeholder={t('login.usernamePlaceholder')}
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              {t('login.password')}
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-200 focus:border-primary-500 outline-none transition-shadow"
              placeholder={t('login.passwordPlaceholder')}
              required
            />
          </div>

          <div className="flex gap-3 pt-2">
            {allowClose && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
              >
                {t('common:buttons.cancel')}
              </button>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className={`flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${!allowClose ? 'w-full' : ''}`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  {t('login.loading')}
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  {t('login.submit')}
                </>
              )}
            </button>
          </div>

          {/* Registreerimise link */}
          <div className="pt-4 border-t border-gray-200 text-center text-sm text-gray-600">
            {t('login.noAccount')}{' '}
            <Link
              to="/register"
              onClick={onClose}
              className="text-primary-600 hover:text-primary-700 font-medium inline-flex items-center gap-1"
            >
              <UserPlus size={14} />
              {t('login.register')}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginModal;
