import type { TFunction } from 'i18next';
import type { UserNotification } from '../types';

/**
 * Teavituse teksti tuletamine.
 *
 * INVARIANT: server ei salvesta lugejale nähtavat lauset, mille ta oskaks
 * teavituse tüübist tuletada. Masina teade (`comment_reply`) renderdatakse
 * SIIN, lugeja praeguses keeles; inimese kirjutatud tekst (admini saadetud
 * sõnum) jääb täpselt nii, nagu ta kirjutati — masintõlget ei tehta.
 *
 * Salvestatud `title` jääb varuvõimaluseks: vana kirje, katkine metadata või
 * tundmatu tüüp langeb selle peale tagasi. Eestikeelne lause on halb,
 * „undefined vastas sinu kommentaarile" on hullem.
 */

/** Tüübid, mille lause server genereerib ja mis tuleb seetõttu ise renderdada. */
const MACHINE_TYPES: Record<string, (n: UserNotification) => boolean> = {
  // Vajab actor_name-i: ilma selleta ei ole lauset, mida renderdada.
  comment_reply: (n) => Boolean(n.actor_name),
};

export const isSentNotification = (notification: UserNotification): boolean =>
  notification.type === 'sent_notification';

export const notificationTitle = (notification: UserNotification, t: TFunction): string => {
  const canRender = MACHINE_TYPES[notification.type];
  if (canRender && canRender(notification)) {
    return t('notifications.commentReply', { actor: notification.actor_name });
  }
  if (notification.title) return notification.title;
  return t('notifications.commentReplyFallback');
};
