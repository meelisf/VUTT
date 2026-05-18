import { UserNotification } from '../types';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

export interface NotificationRecipient {
  username: string;
  name: string;
  role: 'contributor' | 'editor' | 'admin';
}

export interface SendNotificationPayload {
  recipient_mode: 'multiple' | 'all';
  recipient_usernames?: string[];
  title: string;
  body: string;
  link?: string;
}

export const getNotifications = async (
  authToken: string | null,
  unreadOnly = false
): Promise<UserNotification[]> => {
  const qs = unreadOnly ? '?unread=true' : '';
  const response = await fetchWithTimeout(`${FILE_API_URL}/notifications${qs}`, {
    headers: getAuthHeaders(authToken),
    timeout: 5000,
  });

  if (!response.ok) {
    throw new Error(`Notifications failed: ${response.status}`);
  }

  const data = await response.json();
  return data.notifications || [];
};

export const getNotificationRecipients = async (
  authToken: string | null
): Promise<NotificationRecipient[]> => {
  const response = await fetchWithTimeout(`${FILE_API_URL}/notification-recipients`, {
    headers: getAuthHeaders(authToken),
    timeout: 5000,
  });

  if (!response.ok) {
    throw new Error(`Notification recipients failed: ${response.status}`);
  }

  const data = await response.json();
  return data.users || [];
};

export const sendNotification = async (
  authToken: string | null,
  payload: SendNotificationPayload
): Promise<number> => {
  const response = await fetchWithTimeout(`${FILE_API_URL}/notifications/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
    body: JSON.stringify(payload),
    timeout: 8000,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status !== 'success') {
    throw new Error(data.detail || data.message || `Send notification failed: ${response.status}`);
  }

  return data.created || 0;
};

export const markNotificationRead = async (
  authToken: string | null,
  notificationId: string
): Promise<void> => {
  const response = await fetchWithTimeout(`${FILE_API_URL}/notifications/${notificationId}/read`, {
    method: 'POST',
    headers: getAuthHeaders(authToken),
    timeout: 5000,
  });

  if (!response.ok) {
    throw new Error(`Mark notification read failed: ${response.status}`);
  }
};
