/** @vitest-environment jsdom */
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import ScanOriginRow from '../ScanOriginRow';

afterEach(cleanup);

const renderRow = (exemplars: Parameters<typeof ScanOriginRow>[0]['exemplars']) => render(
  <MemoryRouter><ScanOriginRow workId="w1" exemplars={exemplars} /></MemoryRouter>,
);

describe('ScanOriginRow (halduse vahekaart „Leheküljed")', () => {
  it('alus märgitud → „Skaneering:" + link alusele', () => {
    renderRow([{ id: 'a1', holder: 'EAA' }, { id: 'b2', holder: 'Tartu TÜR', shelfmark: 'R Bergm. 357(8)', text_witness: true }]);
    expect(screen.getByText('manage.scanOrigin')).toBeTruthy();
    const link = screen.getByText(/Tartu TÜR/).closest('a');
    expect(link?.getAttribute('href')).toBe('/work/w1/exemplar/b2');
    expect(link?.textContent).toContain('R Bergm. 357(8)');
  });

  it('alus märkimata → „alus märkimata" + „Märgi alus…" rea „Teose lehed" juurde', () => {
    renderRow([{ id: 'a1', holder: 'EAA' }]);
    expect(screen.getByText(/manage\.scanOriginUnset/)).toBeTruthy();
    expect(screen.getByText('manage.scanOriginMark').closest('a')?.getAttribute('href')).toBe('/work/w1/exemplar/pages');
  });

  it('eksemplarideta teosel rida puudub', () => {
    const { container } = renderRow([]);
    expect(container.textContent).toBe('');
  });
});
