import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Bell, Check, ChevronLeft, Loader2, Send } from 'lucide-react';
import Header from '../components/Header';
import { useUser } from '../contexts/UserContext';
import { UserNotification } from '../types';
import {
  getNotificationRecipients,
  getNotifications,
  markNotificationRead,
  NotificationRecipient,
  sendNotification,
} from '../services/notificationService';

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('et-EE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const notificationTitle = (notification: UserNotification, fallback: string) => {
  if (notification.title) return notification.title;
  if (notification.type === 'comment_reply' && notification.actor_name) {
    return `${notification.actor_name} ${fallback}`;
  }
  return fallback;
};

const notificationBody = (notification: UserNotification) => {
  return notification.body || notification.text_preview || '';
};

const notificationLink = (notification: UserNotification) => {
  if (notification.link) return notification.link;
  if (notification.work_id && notification.page_number) {
    const comment = notification.comment_id ? `?comment=${notification.comment_id}` : '';
    return `/work/${notification.work_id}/${notification.page_number}${comment}`;
  }
  return '';
};

const Notifications: React.FC = () => {
  const { t } = useTranslation(['common']);
  const { user, authToken, isLoading } = useUser();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'inbox' | 'send'>('inbox');
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [recipients, setRecipients] = useState<NotificationRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [recipientMode, setRecipientMode] = useState<'single' | 'all'>('single');
  const [recipientUsername, setRecipientUsername] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);

  const canSend = user?.role === 'editor' || user?.role === 'admin';
  const canSendAll = user?.role === 'admin';
  const unreadCount = useMemo(() => notifications.filter(item => !item.read_at).length, [notifications]);

  useEffect(() => {
    if (!authToken || !user) return;
    setLoading(true);
    setError(null);
    getNotifications(authToken)
      .then(setNotifications)
      .catch(() => setError(t('notifications.loadError')))
      .finally(() => setLoading(false));
  }, [authToken, user, t]);

  useEffect(() => {
    if (!authToken || !canSend) return;
    setRecipientsLoading(true);
    getNotificationRecipients(authToken)
      .then(items => {
        setRecipients(items);
        const firstOther = items.find(item => item.username !== user?.username) || items[0];
        if (firstOther) setRecipientUsername(firstOther.username);
      })
      .catch(() => setSendError(t('notifications.recipientsLoadError')))
      .finally(() => setRecipientsLoading(false));
  }, [authToken, canSend, user?.username, t]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!user) return <Navigate to="/" replace />;

  const openNotification = async (notification: UserNotification) => {
    if (authToken && !notification.read_at) {
      await markNotificationRead(authToken, notification.id).catch(() => {});
      setNotifications(items => items.map(item => (
        item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
      )));
    }
    const target = notificationLink(notification);
    if (target) navigate(target);
  };

  const markRead = async (notification: UserNotification) => {
    if (!authToken || notification.read_at) return;
    await markNotificationRead(authToken, notification.id);
    setNotifications(items => items.map(item => (
      item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
    )));
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!authToken) return;
    setSending(true);
    setSendError(null);
    setSendSuccess(null);

    try {
      const count = await sendNotification(authToken, {
        recipient_mode: recipientMode,
        recipient_username: recipientMode === 'single' ? recipientUsername : undefined,
        title: title.trim(),
        body: body.trim(),
        link: link.trim() || undefined,
      });
      setTitle('');
      setBody('');
      setLink('');
      setSendSuccess(t('notifications.sent', { count }));
    } catch (e) {
      setSendError(e instanceof Error ? e.message : t('notifications.sendError'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('notifications.title')} pageTitleIcon={<Bell size={20} className="text-primary-700" />} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          {t('buttons.back')}
        </Link>

        <div className="flex items-center gap-2 border-b border-gray-200 mb-6">
          <button
            onClick={() => setActiveTab('inbox')}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${
              activeTab === 'inbox'
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t('notifications.inbox')} {unreadCount > 0 ? `(${unreadCount})` : ''}
          </button>
          {canSend && (
            <button
              onClick={() => setActiveTab('send')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${
                activeTab === 'send'
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t('notifications.sendTab')}
            </button>
          )}
        </div>

        {activeTab === 'inbox' && (
          <section>
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-7 h-7 animate-spin text-primary-600" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                {t('notifications.empty')}
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map(notification => {
                  const target = notificationLink(notification);
                  return (
                    <article
                      key={notification.id}
                      className={`bg-white border rounded-lg p-4 ${
                        notification.read_at ? 'border-gray-200' : 'border-primary-200 bg-primary-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <button
                          onClick={() => openNotification(notification)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {!notification.read_at && <span className="h-2 w-2 rounded-full bg-red-600 shrink-0" />}
                            <h2 className="text-sm font-semibold text-gray-900">
                              {notificationTitle(notification, t('notifications.commentReplyFallback'))}
                            </h2>
                          </div>
                          {notificationBody(notification) && (
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">{notificationBody(notification)}</p>
                          )}
                          <p className="text-xs text-gray-500 mt-2">
                            {formatDate(notification.created_at)}
                            {notification.actor_name ? ` · ${notification.actor_name}` : ''}
                            {target ? ` · ${target}` : ''}
                          </p>
                        </button>
                        {!notification.read_at && (
                          <button
                            onClick={() => markRead(notification)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-white"
                          >
                            <Check size={14} />
                            {t('notifications.markRead')}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === 'send' && canSend && (
          <section className="max-w-2xl">
            <form onSubmit={handleSend} className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
              {canSendAll && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('notifications.recipientMode')}</label>
                  <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setRecipientMode('single')}
                      className={`px-3 py-2 text-sm ${recipientMode === 'single' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      {t('notifications.singleRecipient')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecipientMode('all')}
                      className={`px-3 py-2 text-sm border-l border-gray-200 ${recipientMode === 'all' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      {t('notifications.allRecipients')}
                    </button>
                  </div>
                </div>
              )}

              {recipientMode === 'single' && (
                <div>
                  <label htmlFor="notification-recipient" className="block text-sm font-medium text-gray-700 mb-2">{t('notifications.recipient')}</label>
                  <select
                    id="notification-recipient"
                    value={recipientUsername}
                    onChange={(event) => setRecipientUsername(event.target.value)}
                    disabled={recipientsLoading}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
                  >
                    {recipients.map(recipient => (
                      <option key={recipient.username} value={recipient.username}>
                        {recipient.name} ({recipient.username}) · {t(`roles.${recipient.role}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="notification-title" className="block text-sm font-medium text-gray-700 mb-2">{t('notifications.messageTitle')}</label>
                <input
                  id="notification-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={160}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="notification-body" className="block text-sm font-medium text-gray-700 mb-2">{t('notifications.body')}</label>
                <textarea
                  id="notification-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={2000}
                  rows={5}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label htmlFor="notification-link" className="block text-sm font-medium text-gray-700 mb-2">{t('notifications.link')}</label>
                <input
                  id="notification-link"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder="/work/..."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {sendError && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{sendError}</div>}
              {sendSuccess && <div className="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{sendSuccess}</div>}

              <button
                type="submit"
                disabled={sending || !title.trim() || (recipientMode === 'single' && !recipientUsername)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {t('notifications.sendAction')}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
};

export default Notifications;
