import { UserNotification } from '../types';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

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
