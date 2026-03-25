# Navigatsiooni redesign — implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restruktuurida VUTT navigatsioon: eraldada UserMenu jagatud komponendiks, lisada Seadete leht (keel + workspace tab eelistus), teisendada Admin leht avaleheks kaartidega koos sub-route'idega.

**Architecture:** Kuus iseseisvat ülesannet järjestikku. UserMenu eraldamine esimesena (teised ülesanded sõltuvad sellest). Admin sub-lehed enne Admin avaleht (avaleht eeldab et sisu on kuskil). Tõlkevõtmete koristus viimasena.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Tailwind CSS 3, React Router 6, lucide-react, react-i18next

---

## Failide kaart

| Fail | Seis |
|------|------|
| `src/components/UserMenu.tsx` | **Luuakse** |
| `src/components/Header.tsx` | Muudetakse (inline menüü → `<UserMenu />`) |
| `src/pages/Workspace.tsx` | Muudetakse (inline menüü → `<UserMenu />`) |
| `src/pages/Settings.tsx` | **Luuakse** |
| `src/components/TextEditor.tsx` | Muudetakse (localStorage default tab) |
| `src/pages/admin/Registrations.tsx` | **Luuakse** |
| `src/pages/admin/Users.tsx` | **Luuakse** |
| `src/pages/admin/Trash.tsx` | **Luuakse** |
| `src/pages/admin/Collections.tsx` | **Luuakse** |
| `src/pages/Admin.tsx` | Muudetakse (tabid → kaardid) |
| `src/App.tsx` | Muudetakse (uued route'id) |
| `src/locales/et/common.json` | Muudetakse |
| `src/locales/en/common.json` | Muudetakse |
| `src/locales/et/settings.json` | **Luuakse** |
| `src/locales/en/settings.json` | **Luuakse** |
| `src/locales/et/admin.json` | Muudetakse |
| `src/locales/en/admin.json` | Muudetakse |

---

## Ülesanne 1: UserMenu komponent

**Eesmärk:** Eralda kasutajamenüü `Header.tsx`-ist omaette komponendiks ja asenda Workspace'i duplikaat-menüü sama komponendiga.

**Failid:**
- Loo: `src/components/UserMenu.tsx`
- Muuda: `src/components/Header.tsx`
- Muuda: `src/pages/Workspace.tsx`

- [ ] **Samm 1: Loo `src/components/UserMenu.tsx`**

Praegune `Header.tsx` sisaldab read 134–194 inline menüü JSX. Loo uus komponent mis sisaldab selle loogika koos uue struktuuriga:

```tsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, History, Shield, LogOut, ChevronDown } from 'lucide-react';
import { useUser } from '../contexts/UserContext';

const UserMenu: React.FC = () => {
  const { t } = useTranslation(['common', 'auth']);
  const { user, logout } = useUser();
  const [showMenu, setShowMenu] = useState(false);

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 hover:bg-gray-100 rounded-lg px-2 py-1 transition-colors"
      >
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-gray-900">{user.name}</p>
          <p className="text-xs text-gray-500">{t(`common:roles.${user.role}`)}</p>
        </div>
        <div className="h-8 w-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold border-2 border-primary-200 text-xs">
          {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${showMenu ? 'rotate-180' : ''}`} />
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setShowMenu(false)} />
          <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-44 z-[110]">
            {/* Mobiilne kasutajainfo */}
            <div className="sm:hidden px-3 py-2 border-b border-gray-100">
              <p className="font-medium text-gray-900 text-sm">{user.name}</p>
              <p className="text-xs text-gray-500">{t(`common:roles.${user.role}`)}</p>
            </div>

            <Link
              to="/settings"
              onClick={() => setShowMenu(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              <Settings size={16} />
              {t('common:nav.settings')}
            </Link>

            <Link
              to="/review"
              onClick={() => setShowMenu(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              <History size={16} />
              {t('common:nav.review')}
            </Link>

            {user.role === 'admin' && (
              <>
                <div className="border-t border-gray-100 my-1" />
                <Link
                  to="/admin"
                  onClick={() => setShowMenu(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  <Shield size={16} />
                  {t('common:nav.admin')}
                </Link>
              </>
            )}

            <div className="border-t border-gray-100 my-1" />

            <button
              onClick={() => { setShowMenu(false); logout(); }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
            >
              <LogOut size={16} />
              {t('auth:login.logout')}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default UserMenu;
```

- [ ] **Samm 2: Uuenda `src/components/Header.tsx`**

Lisa import faili algusesse (asenda olemasolev Users/Upload/Settings/History/LogIn/LogOut import osa):
```tsx
import UserMenu from './UserMenu';
```

Eemaldada `Header.tsx` import-reast: `LogOut, LogIn, History, Settings, Upload, Users` (kontrolli et mõnda neist ei kasutata ka mujal Header.tsx-is — `LogIn` on kasutusel loginModal nupus, see jätta).

Asenda read 119–195 (kogu `{user ? (...) : (...)}` blokk) järgmisega:

```tsx
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
```

- [ ] **Samm 3: Uuenda `src/pages/Workspace.tsx`**

Eemalda importidest: `LogOut, LogIn, Settings, History, Upload` (kontrolli et pole mujal Workspace.tsx-is kasutusel).

Lisa import:
```tsx
import UserMenu from '../components/UserMenu';
```

Eemalda `showUserMenu` useState (rida 59).

Asenda kogu `{user ? (...menüü JSX...) : (...loginButton...)}` blokk (read 447–517):
```tsx
<UserMenu />
```

NB: Workspace'i loginModal ja `showLoginModal` state jäävad alles — need on Workspace'i oma vajadus (sessioon aegub editor sees).

- [ ] **Samm 4: Lisa `nav.settings` tõlkevõti**

`src/locales/et/common.json` — `nav` sektsiooni:
```json
"settings": "Seaded"
```

`src/locales/en/common.json` — `nav` sektsiooni:
```json
"settings": "Settings"
```

- [ ] **Samm 5: Verifitseeri build**

```bash
npm run build
```

Oodatav tulemus: build õnnestub vigadeta. Kontrolli ka et TypeScript ei kurda: `npx tsc --noEmit`.

- [ ] **Samm 6: Commit**

```bash
git add src/components/UserMenu.tsx src/components/Header.tsx src/pages/Workspace.tsx src/locales/et/common.json src/locales/en/common.json
git commit -m "refactor: eralda UserMenu komponendiks, asenda Header ja Workspace inline menüüd"
```

---

## Ülesanne 2: Seadete leht

**Eesmärk:** Loo `/settings` leht keel + workspace vaikimisi tab eelistusega.

**Failid:**
- Loo: `src/pages/Settings.tsx`
- Loo: `src/locales/et/settings.json`
- Loo: `src/locales/en/settings.json`
- Muuda: `src/App.tsx`

- [ ] **Samm 1: Loo `src/locales/et/settings.json`**

```json
{
  "pageTitle": "Seaded",
  "ui": {
    "heading": "Kasutajaliides"
  },
  "language": {
    "label": "Keel"
  },
  "workspace": {
    "heading": "Workspace",
    "defaultTab": {
      "label": "Vaikimisi tab",
      "description": "Milline tab avaneb teose avamisel"
    },
    "edit": "Muutmine",
    "info": "Info & annotatsioonid"
  }
}
```

- [ ] **Samm 2: Loo `src/locales/en/settings.json`**

```json
{
  "pageTitle": "Settings",
  "ui": {
    "heading": "Interface"
  },
  "language": {
    "label": "Language"
  },
  "workspace": {
    "heading": "Workspace",
    "defaultTab": {
      "label": "Default tab",
      "description": "Which tab opens when opening a work"
    },
    "edit": "Edit",
    "info": "Info & annotations"
  }
}
```

- [ ] **Samm 3: Loo `src/pages/Settings.tsx`**

```tsx
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
```

- [ ] **Samm 4: Registreeri `settings` namespace `src/i18n.ts`-is**

`src/i18n.ts` impordid (teiste importide juurde):
```tsx
import etSettings from './locales/et/settings.json';
import enSettings from './locales/en/settings.json';
```

`resources.et` objekti lisa:
```tsx
settings: etSettings,
```

`resources.en` objekti lisa:
```tsx
settings: enSettings,
```

- [ ] **Samm 5: Lisa route `src/App.tsx`**

Lazy import (teiste lazyRetry importide juurde):
```tsx
const Settings = lazyRetry(() => import('./pages/Settings'));
```

Route (teiste route'ide juurde, nt pärast `/review`):
```tsx
{
  path: "/settings",
  element: <Lazy><Settings /></Lazy>,
  errorElement: <RouteErrorBoundary />,
},
```

- [ ] **Samm 5: Verifitseeri build**

```bash
npm run build && npx tsc --noEmit
```

Kontrolli brauseris: `/settings` avaneb, keele toggle töötab, tab eelistus salvestub localStorage'isse.

- [ ] **Samm 6: Commit**

```bash
git add src/pages/Settings.tsx src/locales/et/settings.json src/locales/en/settings.json src/i18n.ts src/App.tsx
git commit -m "feat: lisa Seadete leht — keel ja workspace vaikimisi tab"
```

---

## Ülesanne 3: TextEditor vaikimisi tab localStorage-ist

**Eesmärk:** `TextEditor` loeb workspace vaikimisi tab eelistuse localStorage-ist (lahendab GitHub issue #10).

**Failid:**
- Muuda: `src/components/TextEditor.tsx`

- [ ] **Samm 1: Uuenda `activeTab` algväärtus**

`src/components/TextEditor.tsx` real 103 muuda:

```tsx
// Praegu:
const [activeTab, setActiveTab] = useState<TabType>('edit');

// Uus:
const [activeTab, setActiveTab] = useState<TabType>(
  () => (localStorage.getItem('vutt_workspace_default_tab') as TabType) ?? 'edit'
);
```

- [ ] **Samm 2: Verifitseeri build**

```bash
npm run build && npx tsc --noEmit
```

Kontrolli brauseris: kui Seadetes valitud "Info & annotatsioonid", siis uue teose avamisel avaneb annotate tab.

- [ ] **Samm 3: Commit**

```bash
git add src/components/TextEditor.tsx
git commit -m "feat: TextEditor loeb vaikimisi tab eelistuse localStorage-ist (issue #10)"
```

---

## Ülesanne 4: Admin sub-lehed

**Eesmärk:** Eralda Admin.tsx tabide sisu eraldi lehtedeks. Igal lehel on admin rolli kontroll ja breadcrumb.

**Failid:**
- Loo: `src/pages/admin/Registrations.tsx`
- Loo: `src/pages/admin/Users.tsx`
- Loo: `src/pages/admin/Trash.tsx`
- Loo: `src/pages/admin/Collections.tsx`
- Muuda: `src/App.tsx`

**NB:** Kõik state, API kutsed ja JSX tuleb kopeerida otse `Admin.tsx`-ist vastavatest tabide blokkidest. Pole vaja refaktorida — lihtsalt eralda. Viita sisule (muutuja- ja funktsiooninimed), mitte reaalinumbritele — `Admin.tsx` on 1015 rida ja numbrid võivad muutuda. Iga sub-leht:
- Impordib `Header` ja kasutab `showSearchButton={false}` + `pageTitle`
- Sisaldab breadcrumb: `← Admin` link `/admin`-ile
- Kontrollib `user.role !== 'admin'` ja redirectib `/`-le

- [ ] **Samm 1: Loo `src/pages/admin/Registrations.tsx`**

Kopeeri `Admin.tsx`-ist:
- Kõik `Registration`, `InviteResult` tüübid
- State: `registrations`, `isLoading`, `error`, `inviteResult`, `linkCopied`, `processingId`
- `useEffect` mis laeb registreerimised (praegu laetakse `activeTab === 'registrations'` korral — uues failis lae kohe)
- `handleApprove`, `handleReject`, `formatDate` funktsioonid
- JSX read 619–744 (taotluste sektsioon)

Lisa lehe ülaossa breadcrumb:
```tsx
<Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
  <ChevronLeft size={16} />
  Admin
</Link>
```

- [ ] **Samm 2: Loo `src/pages/admin/Users.tsx`**

Kopeeri `Admin.tsx`-ist:
- `User` tüüp
- State: `users`, `peopleCount`, `editingUser`, `newRole`, `processingUserId`
- `useEffect` mis laeb kasutajad
- `handleRoleChange` funktsioon
- JSX read 744–902 (kasutajate tabel)

**Eemalda** "Isikute register" sektsioon — leia see sisupõhiselt: otsi `<section>` blokki mis sisaldab `peopleCount` muutujat ja "Uuenda" / people-refresh nuppu. Eemalda kogu see `<section>...</section>` blokk. Eemalda ka `peopleCount` state ja sellega seotud `useEffect`.

- [ ] **Samm 3: Loo `src/pages/admin/Trash.tsx`**

Kopeeri `Admin.tsx`-ist:
- `TrashWork` tüüp
- State: `trashWorks`, `trashLoaded`, `restoringId`, `deletingId`
- `useEffect` mis laeb prügikasti
- `handleRestore`, `handlePermanentDelete` funktsioonid
- JSX read 910–1010

- [ ] **Samm 4: Loo `src/pages/admin/Collections.tsx`**

Kopeeri `Admin.tsx`-ist:
- State mis puudutab kollektsioone (praegu `activeTab === 'collections'` blokis)
- JSX rida 903–908 (CollectionEditor komponent)

NB: `CollectionEditor` on omaette komponent — selle leht on lühike.

- [ ] **Samm 5: Lisa route'id `src/App.tsx`**

Lazy importid:
```tsx
const AdminRegistrations = lazyRetry(() => import('./pages/admin/Registrations'));
const AdminUsers = lazyRetry(() => import('./pages/admin/Users'));
const AdminTrash = lazyRetry(() => import('./pages/admin/Trash'));
const AdminCollections = lazyRetry(() => import('./pages/admin/Collections'));
```

Route'id (admin route'i järele):
```tsx
{ path: "/admin/registrations", element: <Lazy><AdminRegistrations /></Lazy>, errorElement: <RouteErrorBoundary /> },
{ path: "/admin/users", element: <Lazy><AdminUsers /></Lazy>, errorElement: <RouteErrorBoundary /> },
{ path: "/admin/trash", element: <Lazy><AdminTrash /></Lazy>, errorElement: <RouteErrorBoundary /> },
{ path: "/admin/collections", element: <Lazy><AdminCollections /></Lazy>, errorElement: <RouteErrorBoundary /> },
```

- [ ] **Samm 6: Verifitseeri build**

```bash
npm run build && npx tsc --noEmit
```

- [ ] **Samm 7: Commit**

```bash
git add src/pages/admin/ src/App.tsx
git commit -m "feat: eralda Admin sub-lehed eraldi route'ideks"
```

---

## Ülesanne 5: Admin avaleht kaartidega

**Eesmärk:** Asenda `Admin.tsx` tabide navigatsioon kaartide avalehega.

**Failid:**
- Muuda: `src/pages/Admin.tsx`
- Muuda: `src/locales/et/admin.json`
- Muuda: `src/locales/en/admin.json`

- [ ] **Samm 1: Lisa tõlkevõtmed `src/locales/et/admin.json`**

Lisa olemasolevasse faili:
```json
"cards": {
  "registrations": "Taotlused",
  "users": "Registreerunud kasutajad",
  "upload": "Laadi üles",
  "collections": "Kollektsioonid",
  "changes": "Muudatused",
  "trash": "Prügikast",
  "pending": "{{count}} ootel"
},
"groups": {
  "users": "Kasutajad",
  "content": "Sisu",
  "settings": "Seadistus",
  "workflow": "Töövoog"
}
```

- [ ] **Samm 2: Lisa tõlkevõtmed `src/locales/en/admin.json`**

```json
"cards": {
  "registrations": "Registrations",
  "users": "Registered users",
  "upload": "Upload",
  "collections": "Collections",
  "changes": "Changes",
  "trash": "Trash",
  "pending": "{{count}} pending"
},
"groups": {
  "users": "Users",
  "content": "Content",
  "settings": "Settings",
  "workflow": "Workflow"
}
```

- [ ] **Samm 3: Kirjuta `src/pages/Admin.tsx` ümber**

Säilita ainult:
- Admin rolli kontroll + redirect
- Ootel taotluste count (API kutse `/api/files/registrations` — ainult `pending` filtriga, et kuvada punane count kaardil)
- Avaleht kaartidega

```tsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserPlus, Users, Upload, Library, History, Trash2 } from 'lucide-react';
import Header from '../components/Header';
import { useUser } from '../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

const FILE_SERVER = import.meta.env.VITE_FILE_SERVER_URL;

interface AdminCard {
  key: string;
  icon: React.ReactNode;
  group: string;
  href: string;
  count?: number;
  countColor?: string;
  countLabel?: string;
}

const Admin: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { user, authToken } = useUser();
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/');
      return;
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!authToken) return;
    fetchWithTimeout(`${FILE_SERVER}/registrations`, {
      headers: getAuthHeaders(authToken),
    })
      .then(r => r.json())
      .then(data => {
        const pending = (data || []).filter((r: any) => r.status === 'pending').length;
        setPendingCount(pending);
      })
      .catch(() => {});
  }, [authToken]);

  if (!user || user.role !== 'admin') return null;

  const cards: AdminCard[] = [
    {
      key: 'registrations',
      icon: <UserPlus size={18} className="text-indigo-700" />,
      group: t('admin:groups.users'),
      href: '/admin/registrations',
      count: pendingCount ?? undefined,
      countColor: 'text-red-600',
      countLabel: t('admin:cards.registrations'),
    },
    {
      key: 'users',
      icon: <Users size={18} className="text-blue-600" />,
      group: t('admin:groups.users'),
      href: '/admin/users',
    },
    {
      key: 'upload',
      icon: <Upload size={18} className="text-teal-600" />,
      group: t('admin:groups.content'),
      href: '/upload',
    },
    {
      key: 'collections',
      icon: <Library size={18} className="text-violet-600" />,
      group: t('admin:groups.settings'),
      href: '/admin/collections',
    },
    {
      key: 'changes',
      icon: <History size={18} className="text-amber-600" />,
      group: t('admin:groups.workflow'),
      href: '/review',
    },
    {
      key: 'trash',
      icon: <Trash2 size={18} className="text-rose-600" />,
      group: t('admin:groups.content'),
      href: '/admin/trash',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle="Admin" />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {cards.map(card => (
            <Link
              key={card.key}
              to={card.href}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-center gap-2 mb-2">
                {card.icon}
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {card.group}
                </span>
              </div>
              <p className="font-semibold text-gray-900 text-sm">
                {t(`admin:cards.${card.key}`)}
              </p>
              {card.count !== undefined && card.count > 0 && (
                <p className={`text-xs font-medium mt-1 ${card.countColor}`}>
                  {t('admin:cards.pending', { count: card.count })}
                </p>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Admin;
```

- [ ] **Samm 4: Verifitseeri build**

```bash
npm run build && npx tsc --noEmit
```

Kontrolli brauseris: `/admin` näitab kaarte, kaartidele klikkimine avab õige lehe, punane count ilmub kui on ootel taotlusi.

- [ ] **Samm 5: Commit**

```bash
git add src/pages/Admin.tsx src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat: Admin avaleht kaartidega, sub-lehed eraldatud"
```

---

## Ülesanne 6: Tõlkevõtmete koristus

**Eesmärk:** Eemalda kasutamata `nav.upload` ja `nav.persons` võtmed.

**Failid:**
- Muuda: `src/locales/et/common.json`
- Muuda: `src/locales/en/common.json`

- [ ] **Samm 1: Kontrolli et võtmed pole enam kasutusel**

```bash
grep -r "nav\.upload\|nav\.persons" src/
```

Oodatav tulemus: 0 tulemust (kõik kasutused on eemaldatud eelmistes ülesannetes).

- [ ] **Samm 2: Eemalda võtmed mõlemast `common.json`-ist**

`src/locales/et/common.json` ja `src/locales/en/common.json` `nav` sektsioonist eemalda:
```json
"upload": "...",
"persons": "..."
```

- [ ] **Samm 3: Verifitseeri build**

```bash
npm run build && npx tsc --noEmit
```

- [ ] **Samm 4: Commit**

```bash
git add src/locales/et/common.json src/locales/en/common.json
git commit -m "chore: eemalda kasutamata nav.upload ja nav.persons tõlkevõtmed"
```

---

## Lõplik kontroll

```bash
npm run build && npx tsc --noEmit
```

Brauseris kontrollida:
- Kasutajamenüü: Seaded / Muudatused / [Admin adminile] / Logi välja
- Workspace päis kasutab sama UserMenu komponenti
- `/settings` — keel + workspace tab
- TextEditor: avab õige tab vastavalt seadele
- `/admin` — 6 kaarti, punane count kui taotlusi
- `/admin/registrations`, `/admin/users`, `/admin/collections`, `/admin/trash` — töötavad breadcrumbiga
