/**
 * Ühtne päise komponent kõigile lehtedele (v.a Workspace ja SetPassword).
 *
 * Tume päis (#587): logo, navigatsioon (Teosed · Täisteksti otsing · Isikud),
 * aktiivse kogu valija (desktop: rippmenüü, mobiil: modaal), kasutajamenüü ja
 * keelevahetaja. Päis on `sticky z-[1200]` — seda kihijärjestust ei muudeta.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, ChevronDown, Library, Bookmark } from 'lucide-react';
import LanguageSwitcher from './LanguageSwitcher';
import LoginModal from './LoginModal';
import UserMenu from './UserMenu';
import CollectionPicker from './CollectionPicker';
import { useUser } from '../contexts/UserContext';
import { useSelectionLabel } from '../hooks/useSelectionLabel';
import { useMediaQuery } from '../hooks/useMediaQuery';

interface HeaderProps {
  /** Valikuline lehe pealkiri (kuvatakse navigatsiooni järel) */
  pageTitle?: string;
  /** Valikuline ikoon pealkirja ees */
  pageTitleIcon?: React.ReactNode;
  /** Lisa children sisu (nt otsinguväli) päise alla */
  children?: React.ReactNode;
}

/**
 * Lehed, mis on ise aktiivse kogu järgi piiratud loendid: kogu vahetus jääb
 * neil paigale. Mujalt (teose leht, admin, seaded) viib kogu valimine selle
 * kogu teoste nimekirja (#587: „kogu valimine on navigeerimine").
 */
const COLLECTION_SCOPED_PATHS = ['/', '/search', '/persons', '/stats'];

const Header: React.FC<HeaderProps> = ({
  pageTitle,
  pageTitleIcon,
  children
}) => {
  const { t } = useTranslation(['dashboard', 'common', 'auth']);
  const { user, sessionExpired, clearSessionExpired } = useUser();
  // Valiku silt ja värv tulevad ÜHEST kohast: `selectedCollection` üksi ei
  // suuda töökollektsiooni väljendada (null = „kõik teosed") ja päis
  // näitas seetõttu `?set=`-valiku ajal „Kõik tööd".
  const { label: selectionLabel, colorClasses: selectionColors, isWorkSet } = useSelectionLabel();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const headerNavigate = useNavigate();
  const location = useLocation();

  // Navigeeri alati dashboardile (koos salvestatud filtritega)
  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const dashboardUrl = sessionStorage.getItem('vutt_dashboard_url') || '/';
    const url = new URL(dashboardUrl, window.location.origin);
    url.searchParams.delete('page');
    headerNavigate(url.pathname + (url.search ? url.search : ''));
  };

  // Kogu valimine väljaspool loendilehti viib selle kogu nimekirja. Paljas `/`:
  // `useCollectionUrlSync` kirjutab URL-i konteksti järgi (puuduv parameeter ei
  // ole väline muutus, ADR 0038), seega uut sünkroniseerimisteed ei teki.
  const handleSelectionChange = () => {
    if (!COLLECTION_SCOPED_PATHS.includes(location.pathname)) headerNavigate('/');
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap ${
      isActive ? 'bg-white/10 text-white font-medium' : 'text-slate-300 hover:text-white hover:bg-white/5'
    }`;

  return (
    <>
      <header className="bg-slate-800 text-slate-100 border-b border-slate-900 sticky top-0 z-[1200] shadow-sm">
        {/* Tume taust on kogu laiuses, sisu jälgib lehe sisu raami (max-w-7xl,
            sama mis kogu-ribal ja loendilehtedel) — suurel ekraanil ei valgu
            logo ja menüü akna servadesse. Workspace'il on oma päis. */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-2 flex items-center justify-between gap-3">
        {/* Vasak pool: logo, navigatsioon, pealkiri */}
        <div className="flex items-center gap-2 sm:gap-5 min-w-0">
          <a href="/" onClick={handleLogoClick} className="hover:opacity-80 transition-opacity flex items-center gap-2 cursor-pointer shrink-0">
            {/* Logo pildil on valge taust — tumedas päises ümmarguse valge märgi peal */}
            <span className="bg-white rounded-full w-8 h-8 sm:w-10 sm:h-10 grid place-items-center shrink-0">
              <img src="/logo.png" alt="VUTT Logo" className="h-5 sm:h-7 w-auto" />
            </span>
            <div>
              <h1 className="text-base sm:text-xl font-bold text-white tracking-tight leading-none">{t('common:app.name')}</h1>
              <p className="hidden lg:block text-[10px] text-slate-400 font-medium tracking-wide uppercase leading-none mt-0.5">{t('common:app.subtitle')}</p>
            </div>
          </a>

          <nav className="hidden md:flex items-center gap-1" aria-label={t('common:nav.label')}>
            <NavLink to="/" end className={navClass}>{t('common:nav.works')}</NavLink>
            <NavLink to="/search" className={navClass}>{t('header.search')}</NavLink>
            <NavLink to="/persons" className={navClass}>{t('common:nav.persons')}</NavLink>
          </nav>

          {pageTitle && (
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 [&_svg]:text-slate-300">
              {pageTitleIcon}
              <span className="text-sm sm:text-lg font-semibold text-white truncate">{pageTitle}</span>
            </div>
          )}
        </div>

        {/* Parem pool: kogu valija, kasutajamenüü, keelevahetaja */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="relative hidden sm:block">
            <button
              onClick={() => setShowCollectionPicker(v => !v)}
              aria-haspopup={isDesktop ? 'listbox' : 'dialog'}
              aria-expanded={showCollectionPicker}
              className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-md border border-slate-600 hover:border-slate-400 text-sm max-w-[18rem] transition-colors"
            >
              {isWorkSet
                ? <Bookmark size={14} className="text-violet-300 shrink-0" />
                : selectionColors
                  ? <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${selectionColors.dot}`} />
                  : <Library size={14} className="text-slate-400 shrink-0" />}
              <span className="truncate text-white">{selectionLabel}</span>
              <ChevronDown size={14} className="text-slate-400 shrink-0" />
            </button>
            {isDesktop && (
              <CollectionPicker
                variant="dropdown"
                isOpen={showCollectionPicker}
                onClose={() => setShowCollectionPicker(false)}
                onSelectionChange={handleSelectionChange}
              />
            )}
          </div>
          {user ? (
            <UserMenu tone="dark" />
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-md hover:bg-primary-700 font-medium text-sm transition-colors"
            >
              <LogIn size={16} />
              {t('auth:login.title')}
            </button>
          )}
          <LanguageSwitcher tone="dark" />
        </div>
        </div>
      </header>

      {/* Valikuline lisa-sisu (nt otsinguväli) */}
      {children}

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => {
          setShowLoginModal(false);
          clearSessionExpired();
        }}
        message={sessionExpired ? t('auth:sessionExpired') : undefined}
      />
      {/* Mobiilis jääb täisekraani-modaal (z-[1300]) */}
      {!isDesktop && (
        <CollectionPicker
          isOpen={showCollectionPicker}
          onClose={() => setShowCollectionPicker(false)}
          onSelectionChange={handleSelectionChange}
        />
      )}
    </>
  );
};

export default Header;
