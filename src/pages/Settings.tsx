import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Header from '../components/Header';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { getCollectionColorClasses } from '../services/collectionService';
import { describeWriteScope } from '../utils/roleUtils';
import { Navigate } from 'react-router-dom';

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const { user, userSettings, updateSettings } = useUser();
  const { collections, getCollectionName } = useCollection();

  // Kirjutamisulatus (ADR 0031) — sama fail-closed loogika mis canEditWork'il.
  // Hook'id peavad olema enne varajast Navigate'i, seega arvutus talub user=null.
  const scope = describeWriteScope(user?.role, user?.edit_collections);
  // null = kasutaja ei ole nuppu puutunud → vaikimisi kinni, v.a ulatuseta
  // contributor (ainus seisund, kus salvestada ei saa kuskil ja tegevusjuhist on
  // vaja). EI tohi olla useState'i algväärtus: esimesel renderdusel on user veel
  // null (UserContext hüdreerib effectis) ja algväärtus jääks igaveseks „lahti".
  const [scopeToggled, setScopeToggled] = useState<boolean | null>(null);
  const scopeOpen = scopeToggled ?? scope.kind === 'none';

  // Ainult autentitud kasutajatele
  if (!user) return <Navigate to="/" replace />;

  const currentLang = (userSettings.language || (i18n.language.startsWith('et') ? 'et' : 'en')) as 'et' | 'en';
  const defaultTab = userSettings.default_tab || 'edit';

  // Kollektsiooni silt tema oma värvides (vt getCollectionColorClasses)
  const collectionChip = (id: string) => {
    const c = getCollectionColorClasses(collections[id] ?? null);
    return (
      <span
        key={id}
        className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${c.bg} ${c.text} ${c.border}`}
      >
        {getCollectionName(id, currentLang)}
      </span>
    );
  };

  // Kokkuklapitud päises näita kuni kaks silti, ülejäänud loendurina —
  // pikk ulatus ei tohi päist lõhkuda.
  const HEADER_CHIPS = 2;

  const handleLangChange = (lang: 'et' | 'en') => {
    updateSettings({ language: lang });
  };

  const handleTabChange = (tab: 'edit' | 'annotate') => {
    updateSettings({ default_tab: tab });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('settings:pageTitle')} />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Õigused — klapitav, vt ADR 0031 */}
        <div>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {t('settings:permissions.heading')}
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg">
            <button
              onClick={() => setScopeToggled(!scopeOpen)}
              aria-expanded={scopeOpen}
              className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-gray-50 transition-colors rounded-lg"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                {scopeOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {t('settings:permissions.title')}
              </span>
              <span className="flex flex-wrap items-center justify-end gap-1.5 text-xs text-gray-500">
                <span className="font-semibold text-gray-900">{t(`common:roles.${user.role}`)}</span>
                <span aria-hidden="true">·</span>
                {scope.kind === 'collections' ? (
                  <>
                    {scope.ids.slice(0, HEADER_CHIPS).map(collectionChip)}
                    {scope.ids.length > HEADER_CHIPS && <span>+{scope.ids.length - HEADER_CHIPS}</span>}
                  </>
                ) : (
                  <span>
                    {scope.kind === 'all'
                      ? t('settings:permissions.scopeAll')
                      : t('settings:permissions.scopeNone')}
                  </span>
                )}
              </span>
            </button>

            {scopeOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                <div className="flex gap-3 text-sm">
                  <span className="w-28 flex-shrink-0 text-xs font-medium text-gray-500 mt-0.5">
                    {t('settings:permissions.roleLabel')}
                  </span>
                  <span className="font-semibold text-gray-900">{t(`common:roles.${user.role}`)}</span>
                </div>

                <div className="flex gap-3 text-sm">
                  <span className="w-28 flex-shrink-0 text-xs font-medium text-gray-500 mt-0.5">
                    {t('settings:permissions.scopeLabel')}
                  </span>
                  {scope.kind === 'collections' ? (
                    <div className="flex flex-wrap gap-1.5">{scope.ids.map(collectionChip)}</div>
                  ) : (
                    <span className="text-gray-900">
                      {scope.kind === 'all'
                        ? t('settings:permissions.scopeAll')
                        : t('settings:permissions.scopeNone')}
                    </span>
                  )}
                </div>

                <p className="text-xs text-gray-500">
                  {scope.kind === 'all'
                    ? t('settings:permissions.allHint')
                    : scope.kind === 'collections'
                      ? t('settings:permissions.contributorHint')
                      : t('settings:permissions.noneHint')}
                </p>
              </div>
            )}
          </div>
        </div>

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
