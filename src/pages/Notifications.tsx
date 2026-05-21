import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Bell, Check, ChevronLeft, Loader2, Reply, Send } from 'lucide-react';
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

const isSentNotification = (notification: UserNotification) => notification.type === 'sent_notification';

const sentRecipientsLabel = (notification: UserNotification, allLabel: string) => {
  const metadata = notification.metadata || {};
  const mode = metadata.recipient_mode;
  const names = metadata.recipient_names;
  const count = metadata.delivered_count;
  if (mode === 'all') {
    return typeof count === 'number' ? `${allLabel} (${count})` : allLabel;
  }
  if (Array.isArray(names) && names.length > 0) {
    return names.filter(item => typeof item === 'string').join(', ');
  }
  return '';
};

const sortRecipients = (items: NotificationRecipient[]) => {
  return [...items].sort((a, b) => {
    if (a.username === 'meelis') return -1;
    if (b.username === 'meelis') return 1;
    return (a.name || a.username).localeCompare(b.name || b.username, 'et');
  });
};

const normalizeInternalLink = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return { link: '', error: '' };

  if (trimmed.startsWith('/')) {
    return { link: trimmed, error: '' };
  }

  try {
    const url = new URL(trimmed);
    if (url.origin === window.location.origin) {
      return { link: `${url.pathname}${url.search}${url.hash}`, error: '' };
    }
    return { link: trimmed, error: 'external' };
  } catch {
    return { link: trimmed, error: 'relative' };
  }
};

const Notifications: React.FC = () => {
  const { t } = useTranslation(['common']);
  const { user, authToken, isLoading } = useUser();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'inbox' | 'send'>('inbox');
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [recipients, setRecipients] = useState<NotificationRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setRecipientsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [sendToAll, setSendToAll] = useState(false);
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [recipientFilter, setRecipientFilter] = useState('');
  const [linkError, setLinkError] = useState('');
  const [replyingTo, setReplyingTo] = useState<UserNotification | null>(null);
  const [sending, setSending] = useState(false);

  const canSend = user?.role === 'editor' || user?.role === 'admin';
  const canSendAll = user?.role === 'admin';
  const unreadCount = useMemo(() => notifications.filter(item => !isSentNotification(item) && !item.read_at).length, [notifications]);
  const filteredRecipients = useMemo(() => {
    const query = recipientFilter.trim().toLowerCase();
    const source = sortRecipients(recipients);
    if (!query) return source;
    return source.filter(recipient => (
      recipient.name.toLowerCase().includes(query)
      || recipient.username.toLowerCase().includes(query)
      || recipient.role.toLowerCase().includes(query)
    ));
  }, [recipients, recipientFilter]);

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
      .then(items => setRecipients(sortRecipients(items)))
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
    if (authToken && !isSentNotification(notification) && !notification.read_at) {
      await markNotificationRead(authToken, notification.id).catch(() => {});
      setNotifications(items => items.map(item => (
        item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
      )));
      window.dispatchEvent(new CustomEvent('vutt:notifications-changed'));
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
    window.dispatchEvent(new CustomEvent('vutt:notifications-changed'));
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!authToken) return;
    setSending(true);
    setSendError(null);
    setSendSuccess(null);
    const normalized = normalizeInternalLink(link);
    if (normalized.error) {
      setLinkError(t('notifications.internalLinkOnly'));
      setSending(false);
      return;
    }

    try {
      const count = await sendNotification(authToken, {
        recipient_mode: sendToAll ? 'all' : 'multiple',
        recipient_usernames: sendToAll ? undefined : Array.from(selectedUsernames),
        title: title.trim(),
        body: body.trim(),
        link: normalized.link || undefined,
      });
      setTitle('');
      setBody('');
      setLink('');
      setLinkError('');
      setReplyingTo(null);
      setSelectedUsernames(new Set());
      setSendToAll(false);
      setSendSuccess(t('notifications.sent', { count }));
    } catch (e) {
      setSendError(e instanceof Error ? e.message : t('notifications.sendError'));
    } finally {
      setSending(false);
    }
  };

  const handleLinkChange = (value: string) => {
    const normalized = normalizeInternalLink(value);
    setLink(normalized.link);
    setLinkError(normalized.error ? t('notifications.internalLinkOnly') : '');
  };

  const startReply = async (notification: UserNotification) => {
    const actor = notification.actor_username || '';
    if (!actor) return;
    if (authToken && !notification.read_at) {
      await markNotificationRead(authToken, notification.id).catch(() => {});
      setNotifications(items => items.map(item => (
        item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
      )));
    }
    setSendToAll(false);
    setSelectedUsernames(new Set([actor]));
    setRecipientFilter('');
    setTitle(notification.title?.startsWith('Re: ') ? notification.title : `Re: ${notification.title || ''}`.trim());
    setBody('');
    setLink(notificationLink(notification));
    setLinkError('');
    setReplyingTo(notification);
    setSendError(null);
    setSendSuccess(null);
    setActiveTab('send');
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
                        isSentNotification(notification)
                          ? 'border-gray-200'
                          : notification.read_at ? 'border-gray-200' : 'border-primary-200 bg-primary-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div
                          onClick={() => openNotification(notification)}
                          className="min-w-0 flex-1 cursor-pointer"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {!isSentNotification(notification) && !notification.read_at && <span className="h-2 w-2 rounded-full bg-red-600 shrink-0" />}
                            <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                              isSentNotification(notification)
                                ? 'bg-gray-100 text-gray-600'
                                : 'bg-primary-100 text-primary-700'
                            }`}>
                              {isSentNotification(notification) ? t('notifications.sentBadge') : t('notifications.receivedBadge')}
                            </span>
                            <h2 className="text-sm font-semibold text-gray-900">
                              {notificationTitle(notification, t('notifications.commentReplyFallback'))}
                            </h2>
                          </div>
                          {notificationBody(notification) && (
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">{notificationBody(notification)}</p>
                          )}
                          {isSentNotification(notification) ? (
                            <p className="text-xs text-gray-500 mt-2">
                              {formatDate(notification.created_at)}
                              {` · ${t('notifications.to')} ${sentRecipientsLabel(notification, t('notifications.allRecipients'))}`}
                              {target ? ` · ${target}` : ''}
                            </p>
                          ) : (
                            <p className="text-xs text-gray-500 mt-2">
                              {notification.actor_name && (
                                <>
                                  <span>{t('notifications.from')} </span>
                                  <span className="font-medium text-gray-800">{notification.actor_name}</span>
                                  <span> · </span>
                                </>
                              )}
                              {formatDate(notification.created_at)}
                              {target ? ` · ${target}` : ''}
                            </p>
                          )}
                        </div>
                        {!isSentNotification(notification) && (
                          <div className="flex shrink-0 flex-col sm:flex-row gap-2">
                            {notification.actor_username && (
                              <button
                                onClick={() => startReply(notification)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-white"
                              >
                                <Reply size={14} />
                                {t('notifications.reply')}
                              </button>
                            )}
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
              {replyingTo && (
                <div className="flex items-start justify-between gap-3 p-3 bg-primary-50 border border-primary-200 rounded-md">
                  <div>
                    <p className="text-sm font-medium text-primary-900">{t('notifications.replyingTo')}</p>
                    <p className="text-xs text-primary-700 mt-1">{notificationTitle(replyingTo, t('notifications.commentReplyFallback'))}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="text-xs font-medium text-primary-700 hover:text-primary-900"
                  >
                    {t('buttons.cancel')}
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">{t('notifications.recipient')}</label>
                {canSendAll && (
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={sendToAll}
                      onChange={(event) => setSendToAll(event.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    {t('notifications.allRecipients')}
                  </label>
                )}
                {!sendToAll && (
                  <>
                    <input
                      value={recipientFilter}
                      onChange={(event) => setRecipientFilter(event.target.value)}
                      placeholder={t('notifications.recipientFilter')}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <div className="max-h-40 overflow-y-auto border border-gray-300 rounded-md divide-y divide-gray-100">
                      {filteredRecipients.map(recipient => (
                        <label
                          key={recipient.username}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedUsernames.has(recipient.username)}
                            onChange={() => {
                              setSelectedUsernames(prev => {
                                const next = new Set(prev);
                                if (next.has(recipient.username)) next.delete(recipient.username);
                                else next.add(recipient.username);
                                return next;
                              });
                            }}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-sm text-gray-800">{recipient.name} ({recipient.username})</span>
                          <span className="ml-auto text-xs text-gray-500 shrink-0">{t(`roles.${recipient.role}`)}</span>
                        </label>
                      ))}
                      {filteredRecipients.length === 0 && (
                        <p className="text-xs text-gray-500 px-3 py-2">{t('notifications.noRecipients')}</p>
                      )}
                    </div>
                    {selectedUsernames.size > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(selectedUsernames).map(username => {
                          const name = recipients.find(r => r.username === username)?.name || username;
                          return (
                            <span key={username} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 bg-primary-100 text-primary-800 rounded-full text-xs font-medium">
                              {name}
                              <button
                                type="button"
                                onClick={() => setSelectedUsernames(prev => { const next = new Set(prev); next.delete(username); return next; })}
                                className="hover:text-primary-900 leading-none"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

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
                  onChange={(event) => handleLinkChange(event.target.value)}
                  placeholder="/work/..."
                  className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                    linkError ? 'border-red-300' : 'border-gray-300'
                  }`}
                />
                {link && !linkError && (
                  <p className="mt-1 text-xs text-gray-500">{t('notifications.linkNormalized', { link })}</p>
                )}
                {linkError && (
                  <p className="mt-1 text-xs text-red-600">{linkError}</p>
                )}
              </div>

              {sendError && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{sendError}</div>}
              {sendSuccess && <div className="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">{sendSuccess}</div>}

              <button
                type="submit"
                disabled={sending || Boolean(linkError) || !title.trim() || (!sendToAll && selectedUsernames.size === 0)}
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
