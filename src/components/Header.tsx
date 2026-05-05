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
import { Link, useNavigate } from 'react-router-dom';
import { Search, LogIn, ChevronDown, Library } from 'lucide-react';
import LanguageSwitcher from './LanguageSwitcher';
import LoginModal from './LoginModal';
import UserMenu from './UserMenu';
import CollectionPicker from './CollectionPicker';
import { useUser } from '../contexts/UserContext';
import { useCollection } from '../contexts/CollectionContext';
import { getCollectionColorClasses } from '../services/collectionService';
import { getLangCode } from '../utils/getLangCode';

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
  const { user, sessionExpired, clearSessionExpired } = useUser();
  const { selectedCollection, getCollectionName, collections } = useCollection();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const lang = getLangCode(i18n.language);
  const headerNavigate = useNavigate();

  // Navigeeri alati dashboardile (koos salvestatud filtritega)
  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const dashboardUrl = sessionStorage.getItem('vutt_dashboard_url') || '/';
    const url = new URL(dashboardUrl, window.location.origin);
    url.searchParams.delete('page');
    headerNavigate(url.pathname + (url.search ? url.search : ''));
  };

  return (
    <>
      <header className="bg-white border-b border-gray-200 px-3 py-2 sm:px-6 sm:py-3 flex items-center justify-between sticky top-0 z-[1200] shadow-sm">
        {/* Vasak pool: logo, otsing, pealkiri */}
        <div className="flex items-center gap-2 sm:gap-4">
          <a href="/" onClick={handleLogoClick} className="hover:opacity-80 transition-opacity flex items-center gap-2 cursor-pointer">
            <img src="/logo.png" alt="VUTT Logo" className="h-6 sm:h-8 w-auto" />
            <div>
              <h1 className="text-base sm:text-xl font-bold text-primary-900 tracking-tight leading-none">{t('common:app.name')}</h1>
              <p className="hidden sm:block text-[10px] text-gray-500 font-medium tracking-wide uppercase leading-none mt-0.5">{t('common:app.subtitle')}</p>
            </div>
          </a>

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
            <div className="flex items-center gap-1.5 sm:gap-2">
              {pageTitleIcon}
              <span className="text-sm sm:text-lg font-bold text-primary-900 whitespace-nowrap">{pageTitle}</span>
            </div>
          )}
        </div>

        {/* Parem pool: kasutajamenüü + keelevahetaja */}
        <div className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <UserMenu />
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-md hover:bg-primary-700 font-medium text-sm transition-colors"
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

      <LoginModal
        isOpen={showLoginModal || sessionExpired}
        onClose={() => {
          setShowLoginModal(false);
          clearSessionExpired();
        }}
        message={sessionExpired ? t('auth:sessionExpired') : undefined}
      />
      <CollectionPicker isOpen={showCollectionPicker} onClose={() => setShowCollectionPicker(false)} />
    </>
  );
};

export default Header;
