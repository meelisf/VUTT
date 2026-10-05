import { describe, expect, it } from 'vitest';
import { groupUsernames, isGroupSelected, shortenNames, toggleGroup } from '../notificationGroups';
import type { NotificationRecipient } from '../../services/notificationService';

const users: NotificationRecipient[] = [
  { username: 'a1', name: 'A1', role: 'admin' },
  { username: 's1', name: 'S1', role: 'superadmin' },
  { username: 'e1', name: 'E1', role: 'editor' },
  { username: 'c1', name: 'C1', role: 'contributor' },
  { username: 'c2', name: 'C2', role: 'contributor' },
];

describe('rollirühmad', () => {
  it('administraatorite rühm sisaldab ka superadmini', () => {
    expect(groupUsernames(users, 'admins')).toEqual(['a1', 's1']);
  });

  it('rühma klõps lisab puuduolevad liikmed ja säilitab muu valiku', () => {
    const next = toggleGroup(users, 'contributors', new Set(['e1', 'c1']));
    expect([...next].sort()).toEqual(['c1', 'c2', 'e1']);
  });

  it('täielikult valitud rühma klõps eemaldab ainult selle rühma', () => {
    const next = toggleGroup(users, 'contributors', new Set(['e1', 'c1', 'c2']));
    expect([...next]).toEqual(['e1']);
  });

  it('osaliselt valitud rühm ei ole valitud; tühi rühm ei ole kunagi valitud', () => {
    expect(isGroupSelected(users, 'contributors', new Set(['c1']))).toBe(false);
    expect(isGroupSelected([], 'editors', new Set())).toBe(false);
  });
});

describe('shortenNames', () => {
  it('lühendab pika loendi', () => {
    expect(shortenNames(['a', 'b', 'c'], 2)).toBe('a, b +1');
    expect(shortenNames(['a', 'b'], 2)).toBe('a, b');
  });
});
