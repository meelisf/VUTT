import { describe, expect, it } from 'vitest';
import { isSentNotification, notificationTitle } from '../notificationText';
import type { UserNotification } from '../../types';

// Tõlkefunktsiooni asendaja: tagastab võtme ja parameetrid, et test näeks,
// MILLIST võtit kasutati — mitte ainult seda, et mingi string tuli.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts?.actor ? `${key}:${opts.actor}` : key) as never;

const base: UserNotification = {
  id: 'n1',
  type: 'comment_reply',
  recipient_username: 'mari',
  created_at: '2026-09-05T10:00:00',
};

describe('notificationTitle', () => {
  it('renderdab masina teate tüübist, mitte salvestatud eestikeelsest lausest', () => {
    const n = { ...base, actor_name: 'Anne', title: 'Anne vastas sinu kommentaarile' };
    expect(notificationTitle(n, t)).toBe('notifications.commentReply:Anne');
  });

  it('langeb salvestatud pealkirjale, kui actor_name puudub', () => {
    const n = { ...base, title: 'Keegi vastas sinu kommentaarile' };
    expect(notificationTitle(n, t)).toBe('Keegi vastas sinu kommentaarile');
  });

  it('ei renderda undefined-it, kui ei ole pealkirja ega actor_name-i', () => {
    expect(notificationTitle(base, t)).toBe('notifications.commentReplyFallback');
  });

  it('inimese kirjutatud pealkirja ei asenda', () => {
    const n: UserNotification = { ...base, type: 'sent_notification', title: 'Koosolek reedel' };
    expect(notificationTitle(n, t)).toBe('Koosolek reedel');
  });

  it('tundmatu tüüp langeb salvestatud pealkirjale', () => {
    const n: UserNotification = { ...base, type: 'midagi_uut', title: 'Uus asi' };
    expect(notificationTitle(n, t)).toBe('Uus asi');
  });
});

describe('isSentNotification', () => {
  it('eristab saadetud koopiat saabunud teatest', () => {
    expect(isSentNotification({ ...base, type: 'sent_notification' })).toBe(true);
    expect(isSentNotification(base)).toBe(false);
  });
});
