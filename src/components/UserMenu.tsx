import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, History, Shield, LogOut, ChevronDown, Bell } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { UserNotification } from '../types';
import { getNotifications, markNotificationRead } from '../services/notificationService';

const UserMenu: React.FC = () => {
  const { t } = useTranslation(['common', 'auth']);
  const { user, authToken, logout } = useUser();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);

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
  }, [user, authToken]);

  if (!user) return null;

  const unreadCount = notifications.filter(n => !n.read_at).length;

  const openNotification = async (notification: UserNotification) => {
    if (authToken && !notification.read_at) {
      await markNotificationRead(authToken, notification.id).catch(() => {});
      setNotifications(items => items.map(item => (
        item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
      )));
    }
    setShowMenu(false);
    if (notification.link) {
      navigate(notification.link);
    } else if (notification.work_id && notification.page_number) {
      navigate(`/work/${notification.work_id}/${notification.page_number}?comment=${notification.comment_id || ''}`);
    } else {
      navigate('/notifications');
    }
  };

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
          {unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center font-bold border border-white">
              {unreadCount > 9 ? '9+' : unreadCount}
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

            {notifications.length > 0 && (
              <>
                <div className="px-3 py-2 border-b border-gray-100">
                  <p className="text-xs font-semibold uppercase text-gray-500 mb-1">{t('common:notifications.title')}</p>
                  <div className="max-h-56 overflow-y-auto -mx-1">
                    {notifications.slice(0, 5).map(notification => (
                      <button
                        key={notification.id}
                        onClick={() => openNotification(notification)}
                        className="w-full text-left px-1 py-2 rounded hover:bg-gray-100"
                      >
                        <div className="flex items-start gap-2">
                          {!notification.read_at && <span className="mt-1.5 h-2 w-2 rounded-full bg-red-600 shrink-0" />}
                          <div className={!notification.read_at ? '' : 'ml-4'}>
                            <p className="text-xs text-gray-800">
                              {notification.title || t('common:notifications.commentReply', { name: notification.actor_name })}
                            </p>
                            <p className="text-xs text-gray-500 truncate max-w-64">
                              {notification.body || notification.text_preview}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <Link
                    to="/notifications"
                    onClick={() => setShowMenu(false)}
                    className="mt-1 block text-xs font-medium text-primary-700 hover:text-primary-800"
                  >
                    {t('common:notifications.viewAll')}
                  </Link>
                </div>
              </>
            )}

            <Link
              to="/notifications"
              onClick={() => setShowMenu(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              <Bell size={16} />
              {t('common:nav.notifications')}
            </Link>

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
