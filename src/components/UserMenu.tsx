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
