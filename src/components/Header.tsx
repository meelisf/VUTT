/**
 * Ühtne päise komponent kõigile lehtedele (v.a Workspace ja SetPassword).
 * 
 * Sisaldab:
 * - Logo ja VUTT nimi (vasakul)
 * - Valikuline täistekstotsingu nupp
 * - Valikuline lehe pealkiri
 * - Kasutajamenüü (paremal) - avatar, Review link, Admin link, logout
 * - Keelevahetaja
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Search, LogOut, LogIn, History, Settings, ChevronDown, Library } from 'lucide-react';
import LanguageSwitcher from './LanguageSwitcher';
import LoginModal from './LoginModal';
import CollectionPicker from './CollectionPicker';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { getCollectionColorClasses } from '../services/collectionService';

interface HeaderProps {
  /** Kuva täistekstotsingu nupp (vaikimisi true) */
  showSearchButton?: boolean;
  /** Valikuline lehe pealkiri (kuvatakse logo kõrval) */
  pageTitle?: string;
  /** Valikuline ikoon pealkirja ees */
  pageTitleIcon?: React.ReactNode;
  /** Lisa children sisu (nt otsinguväli) päise alla */
  children?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({
  showSearchButton = true,
  pageTitle,
  pageTitleIcon,
  children
}) => {
  const { t, i18n } = useTranslation(['dashboard', 'common', 'auth']);
  const { user, logout } = useUser();
  const { selectedCollection, getCollectionName, collections } = useCollection();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const lang = (i18n.language as 'et' | 'en') || 'et';

  return (
    <>
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        {/* Vasak pool: logo, otsing, pealkiri */}
        <div className="flex items-center gap-4">
          <Link to="/" className="hover:opacity-80 transition-opacity flex items-center gap-2">
            <img src="/logo.png" alt="VUTT Logo" className="h-8 w-auto" />
            <div>
              <h1 className="text-xl font-bold text-primary-900 tracking-tight leading-none">{t('common:app.name')}</h1>
              <p className="text-[10px] text-gray-500 font-medium tracking-wide uppercase leading-none mt-0.5">{t('common:app.subtitle')}</p>
            </div>
          </Link>

          {/* Täistekstotsingu nupp (kõigepealt) */}
          {showSearchButton && (
            <>
              <div className="h-6 w-px bg-gray-200 hidden sm:block" />
              <Link
                to="/search"
                className="hidden sm:flex items-center gap-1.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded-md transition-colors"
              >
                <Search size={16} />
                {t('header.fullTextSearch')}
              </Link>
            </>
          )}

          <div className="h-6 w-px bg-gray-200 hidden sm:block" />

          {/* Kollektsiooni valija (laiem, et kollektsiooni nimi mahuks) */}
          {(() => {
            const colorClasses = selectedCollection ? getCollectionColorClasses(collections[selectedCollection]) : null;
            return (
              <button
                onClick={() => setShowCollectionPicker(true)}
                className={`hidden sm:flex items-center gap-2 text-sm px-3 py-1.5 rounded-md transition-colors border ${
                  selectedCollection && colorClasses
                    ? `${colorClasses.bg} ${colorClasses.border} ${colorClasses.text} ${colorClasses.hoverBg}`
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Library size={16} className={selectedCollection && colorClasses ? colorClasses.text : 'text-primary-600'} />
                <span className="max-w-72 truncate font-medium">
                  {selectedCollection
                    ? getCollectionName(selectedCollection, lang)
                    : t('common:collections.all', 'Kõik tööd')}
                </span>
                <ChevronDown size={14} className={selectedCollection && colorClasses ? colorClasses.text : 'text-gray-400'} />
              </button>
            );
          })()}

          {pageTitle && (
            <div className="flex items-center gap-2">
              {pageTitleIcon}
              <span className="text-lg font-bold text-primary-900">{pageTitle}</span>
            </div>
          )}
        </div>

        {/* Parem pool: kasutajamenüü + keelevahetaja */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 hover:bg-gray-100 rounded-lg px-2 py-1 transition-colors"
              >
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-gray-900">{user.name}</p>
                  <p className="text-xs text-gray-500">{t(`common:roles.${user.role}`)}</p>
                </div>
                <div className="h-8 w-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold border-2 border-primary-200 text-xs">
                  {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-[100]" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-44 z-[110]">
                    {/* Mobiilne kasutajainfo */}
                    <div className="sm:hidden px-3 py-2 border-b border-gray-100">
                      <p className="font-medium text-gray-900 text-sm">{user.name}</p>
                      <p className="text-xs text-gray-500">{t(`common:roles.${user.role}`)}</p>
                    </div>

                    <Link
                      to="/review"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <History size={16} />
                      {t('common:nav.review')}
                    </Link>

                    {user.role === 'admin' && (
                      <Link
                        to="/admin"
                        onClick={() => setShowUserMenu(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        <Settings size={16} />
                        {t('common:nav.admin')}
                      </Link>
                    )}

                    <div className="border-t border-gray-100 my-1" />

                    <button
                      onClick={() => { setShowUserMenu(false); logout(); }}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                    >
                      <LogOut size={16} />
                      {t('auth:login.logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-md hover:bg-primary-700 font-medium text-sm transition-colors"
            >
              <LogIn size={16} />
              {t('auth:login.title')}
            </button>
          )}
          <LanguageSwitcher />
        </div>
      </header>

      {/* Valikuline lisa-sisu (nt otsinguväli) */}
      {children}

      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <CollectionPicker isOpen={showCollectionPicker} onClose={() => setShowCollectionPicker(false)} />
    </>
  );
};

export default Header;
