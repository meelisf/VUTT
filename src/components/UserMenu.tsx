import React, { useEffect, useState } from 'react';
import { isAtLeast } from '../utils/roleUtils';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, History, Shield, LogOut, ChevronDown, Bell } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { UserNotification } from '../types';
import { getNotifications } from '../services/notificationService';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

const UserMenu: React.FC = () => {
  const { t } = useTranslation(['common', 'auth', 'admin']);
  const { user, authToken, logout } = useUser();
  const [showMenu, setShowMenu] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [pendingRegistrationCount, setPendingRegistrationCount] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const handler = () => setRefreshTick(n => n + 1);
    window.addEventListener('vutt:notifications-changed', handler);
    return () => window.removeEventListener('vutt:notifications-changed', handler);
  }, []);

  useEffect(() => {
    if (!user || !authToken) return;

    let cancelled = false;
    const load = async () => {
      try {
        const items = await getNotifications(authToken);
        if (!cancelled) setNotifications(items);
      } catch {
        if (!cancelled) setNotifications([]);
      }
    };

    load();
    const id = window.setInterval(load, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user, authToken, refreshTick]);

  useEffect(() => {
    if (!user || !isAtLeast(user.role, 'admin') || !authToken) {
      setPendingRegistrationCount(0);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetchWithTimeout(`${FILE_API_URL}/admin/registrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
          body: JSON.stringify({}),
          timeout: 5000,
        });
        const data = await response.json();
        const registrations = Array.isArray(data.registrations) ? data.registrations : [];
        const pendingCount = registrations.filter((item: { status?: string }) => item.status === 'pending').length;
        if (!cancelled) setPendingRegistrationCount(pendingCount);
      } catch {
        if (!cancelled) setPendingRegistrationCount(0);
      }
    };

    load();
    const id = window.setInterval(load, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user, authToken]);

  if (!user) return null;

  const isSentNotification = (notification: UserNotification) => notification.type === 'sent_notification';
  const receivedNotifications = notifications.filter(n => !isSentNotification(n));
  const unreadCount = receivedNotifications.filter(n => !n.read_at).length;
  const badgeCount = unreadCount + pendingRegistrationCount;


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
        <div className="relative h-8 w-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold border-2 border-primary-200 text-xs">
          {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
          {badgeCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center font-bold border border-white">
              {badgeCount > 9 ? '9+' : badgeCount}
            </span>
          )}
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
              to="/notifications"
              onClick={() => setShowMenu(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              <Bell size={16} />
              <span className="flex-1">{t('common:nav.notifications')}</span>
              {unreadCount > 0 && (
                <span className="min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>

            <Link
              to="/settings"
              onClick={() => setShowMenu(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              <Settings size={16} />
              {t('common:nav.settings')}
            </Link>

            {!isAtLeast(user.role, 'admin') && (
              <Link
                to="/review"
                onClick={() => setShowMenu(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                <History size={16} />
                {t('common:nav.review')}
              </Link>
            )}

            {isAtLeast(user.role, 'admin') && (
              <Link
                to="/admin"
                onClick={() => setShowMenu(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                <Shield size={16} />
                <span className="flex-1">{t('common:nav.admin')}</span>
                {pendingRegistrationCount > 0 && (
                  <span className="min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center font-bold">
                    {pendingRegistrationCount > 9 ? '9+' : pendingRegistrationCount}
                  </span>
                )}
              </Link>
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
