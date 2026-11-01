/** @vitest-environment jsdom */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ArchiveSelect from '../ArchiveSelect';

const renderAs = (userRole: string) => render(
  <ArchiveSelect archives={{ TÜR: { name: 'Tartu Ülikooli raamatukogu' } }} value="" onChange={() => {}}
    onArchiveAdded={() => {}} userRole={userRole} authToken="tok" />,
);

afterEach(() => cleanup());

describe('ArchiveSelect — uue hoidja lisamise õigus', () => {
  it.each(['admin', 'superadmin'])('%s saab lisamisvormi', role => {
    renderAs(role);
    fireEvent.click(screen.getByTitle('admin:archives.addArchive'));
    // Vormi tunneb ära ID/nime väljade järgi; palve-modaali tekst ei tohi tulla
    expect(screen.queryByText('admin:archives.requestBody')).toBeNull();
    expect(document.querySelectorAll('input').length).toBeGreaterThanOrEqual(2);
  });

  it('toimetaja saab ainult palve saata', () => {
    renderAs('editor');
    fireEvent.click(screen.getByTitle('admin:archives.addArchive'));
    expect(document.querySelectorAll('input').length).toBe(0);
  });

  it('kaastöölisel lisamisnuppu ei ole', () => {
    renderAs('contributor');
    expect(screen.queryByTitle('admin:archives.addArchive')).toBeNull();
  });
});
