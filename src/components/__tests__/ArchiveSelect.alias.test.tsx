/** @vitest-environment jsdom */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { alias?: string }) => (o?.alias ? `${k}:${o.alias}` : k) }),
}));

import ArchiveSelect, { archiveFilterMatch } from '../ArchiveSelect';

// Filtririda ilmub alles üle 8 hoidja.
const ARCHIVES = Object.fromEntries([
  ['Helsinki KK', { name: 'Kansalliskirjasto', aliases: ['Helsinki YK', 'Helsingi ÜR'] }],
  ...Array.from({ length: 9 }, (_, i) => [`X${i}`, { name: `Muu ${i}` }]),
]);

afterEach(() => cleanup());

describe('archiveFilterMatch', () => {
  const info = ARCHIVES['Helsinki KK'];
  it('teise nimekuju järgi leitud hoidja näitab, milline kuju sobis', () => {
    expect(archiveFilterMatch('Helsinki KK', info, 'ür')).toEqual({ match: true, viaAlias: 'Helsingi ÜR' });
  });
  it('lühendi või nime järgi leitud hoidjal nimekuju ei näidata', () => {
    expect(archiveFilterMatch('Helsinki KK', info, 'helsinki')).toEqual({ match: true });
    expect(archiveFilterMatch('Helsinki KK', info, 'kansalli')).toEqual({ match: true });
  });
  it('tühi filter sobib kõigile, vale ei sobi', () => {
    expect(archiveFilterMatch('Helsinki KK', info, '')).toEqual({ match: true });
    expect(archiveFilterMatch('Helsinki KK', info, 'uppsala')).toEqual({ match: false });
  });
});

describe('ArchiveSelect — sobinud nimekuju on real näha', () => {
  it('„Helsingi ÜR" otsing näitab Helsinki KK real nimekuju', () => {
    render(<ArchiveSelect archives={ARCHIVES} value="" onChange={() => {}} onArchiveAdded={() => {}}
      userRole="editor" authToken="tok" />);
    fireEvent.click(screen.getByText(/admin:archives.selectPlaceholder/));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Helsingi ÜR' } });
    expect(screen.getByText('Helsinki KK')).toBeTruthy();
    expect(screen.getByText('(admin:archives.matchedAlias:Helsingi ÜR)')).toBeTruthy();
  });
});
