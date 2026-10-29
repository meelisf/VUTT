import { UserNotification } from '../types';
import { FILE_API_URL } from '../config';
import { apiGet, apiPost } from './apiClient';

export interface NotificationRecipient {
  username: string;
  name: string;
  role: 'contributor' | 'editor' | 'admin' | 'superadmin';
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
  const data = await apiGet<{ notifications?: UserNotification[] }>(
    `${FILE_API_URL}/notifications${qs}`, { token: authToken, timeout: 5000 });
  return data?.notifications || [];
};

export const getNotificationRecipients = async (
  authToken: string | null
): Promise<NotificationRecipient[]> => {
  const data = await apiGet<{ users?: NotificationRecipient[] }>(
    `${FILE_API_URL}/notification-recipients`, { token: authToken, timeout: 5000 });
  return data?.users || [];
};

export const sendNotification = async (
  authToken: string | null,
  payload: SendNotificationPayload
): Promise<number> => {
  const data = await apiPost<{ status?: string; created?: number; message?: string }>(
    `${FILE_API_URL}/notifications/send`, payload, { token: authToken, timeout: 8000 });
  if (data?.status !== 'success') {
    throw new Error(data?.message || 'Send notification failed');
  }
  return data.created || 0;
};

export const markNotificationRead = async (
  authToken: string | null,
  notificationId: string
): Promise<void> => {
  await apiPost(`${FILE_API_URL}/notifications/${notificationId}/read`, undefined, { token: authToken, timeout: 5000 });
};
