/** @vitest-environment jsdom */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Exemplar } from '../../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, string>) => (o?.pages ? `${k}:${o.pages}` : k) }),
}));

import ExemplarCards from '../ExemplarCards';

afterEach(cleanup);

// occgcn (Relatio 1632): alus Uppsalas, TÜR-is selle paberkoopia
const exemplars: Exemplar[] = [
  { id: 'hyorfi', holder: 'Tallinn TLÜAR', shelfmark: 'Baltika kogu, III-140', url: 'https://www.ester.ee/record=b1510692', pages: ['0007'] },
  { id: 'ecb2kb', holder: 'Uppsala UB', shelfmark: 'Rar 10:252', text_witness: true },
  { id: 'd6gcpv', holder: 'Tartu TÜR', shelfmark: 'R Acad. Dorp. 1632:1', reproduction: { kind: 'paberkoopia', of: 'ecb2kb' } },
];
const archives = { 'Uppsala UB': { name: 'Uppsala Universitetsbibliotek' } };

describe('ExemplarCards', () => {
  it('alus esimesena, sildiga; teistel lühimärge (erandlehed, koopia liik)', () => {
    const { container } = render(
      <ExemplarCards exemplars={exemplars} pageNumbers={{ '0007': 7 }} archiveRefs={[]} archives={archives} />,
    );
    const cards = container.querySelectorAll('[data-testid="exemplar-cards"] > div');
    expect(cards).toHaveLength(3);
    expect(cards[0].textContent).toContain('Uppsala UB — Uppsala Universitetsbibliotek');
    expect(cards[0].textContent).toContain('exemplars.witness');
    expect(cards[1].textContent).toContain('info.exemplarPages:7');
    expect(cards[1].querySelector('a')?.getAttribute('href')).toBe('https://www.ester.ee/record=b1510692');
    expect(cards[2].textContent).toContain('exemplars.reproduction.kinds.paberkoopia');
    expect(screen.getAllByText('exemplars.witness')).toHaveLength(1);
  });

  it('laadimata: tuletatud viited ilma esiletõstuta', () => {
    render(
      <ExemplarCards exemplars={null} pageNumbers={{}} archiveRefs={[{ archive_id: 'Uppsala UB', reference: 'Rar 10:252' }]} archives={archives} />,
    );
    expect(screen.getByText('Rar 10:252')).toBeTruthy();
    expect(screen.queryByText('exemplars.witness')).toBeNull();
    expect(screen.queryByTestId('exemplar-cards')).toBeNull();
  });
});
