import React from 'react';
import { useTranslation } from 'react-i18next';
import Header from '../components/Header';
import { useUser } from '../contexts/UserContext';
import { Navigate } from 'react-router-dom';

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { user } = useUser();

  // Ainult autentitud kasutajatele
  if (!user) return <Navigate to="/" replace />;

  const currentLang = i18n.language.startsWith('et') ? 'et' : 'en';

  const handleLangChange = (lang: 'et' | 'en') => {
    i18n.changeLanguage(lang);
  };

  const defaultTab = (localStorage.getItem('vutt_workspace_default_tab') as 'edit' | 'annotate') ?? 'edit';

  const handleTabChange = (tab: 'edit' | 'annotate') => {
    localStorage.setItem('vutt_workspace_default_tab', tab);
    // Force re-render
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('settings:pageTitle')} />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Kasutajaliides */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {t('settings:ui.heading')}
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm font-medium text-gray-900 mb-3">{t('settings:language.label')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleLangChange('et')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentLang === 'et'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Eesti
              </button>
              <button
                onClick={() => handleLangChange('en')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentLang === 'en'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                English
              </button>
            </div>
          </div>
        </div>

        {/* Workspace */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {t('settings:workspace.heading')}
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm font-medium text-gray-900 mb-1">{t('settings:workspace.defaultTab.label')}</p>
            <p className="text-xs text-gray-500 mb-3">{t('settings:workspace.defaultTab.description')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleTabChange('edit')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  defaultTab === 'edit'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {t('settings:workspace.edit')}
              </button>
              <button
                onClick={() => handleTabChange('annotate')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  defaultTab === 'annotate'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {t('settings:workspace.info')}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Settings;
