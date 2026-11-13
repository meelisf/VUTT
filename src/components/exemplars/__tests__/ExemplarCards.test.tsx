/** @vitest-environment jsdom */
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Exemplar } from '../../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, string | number>) => (o?.pages ? `${k}:${o.pages}` : o?.count !== undefined ? `${k}:${o.count}` : k) }),
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
    expect(cards[2].textContent).toContain('exemplars.reproduction.kinds.paberkoopia: Uppsala UB');
    expect(screen.getAllByText('exemplars.witness')).toHaveLength(1);
  });

  it('koopia märge: originaal on link selle eksemplari lehele, märkerida hoidja all', () => {
    const { container } = render(
      <MemoryRouter>
        <ExemplarCards exemplars={exemplars} pageNumbers={{}} archiveRefs={[]} archives={archives} workId="w1" />
      </MemoryRouter>,
    );
    const notes = container.querySelectorAll('[data-testid="exemplar-notes"]');
    const copy = [...notes].find(n => n.textContent?.includes('paberkoopia'))!;
    expect(copy.querySelector('a')?.getAttribute('href')).toBe('/work/w1/exemplar/ecb2kb');
  });

  it('koopia ilma allikata → ainult liik; sama hoidja mitu eksemplari → kohaviit juurde', () => {
    const list: Exemplar[] = [
      { id: 'o1', holder: 'Uppsala UB', shelfmark: 'Rar 10:252' },
      { id: 'o2', holder: 'Uppsala UB', shelfmark: 'Rar 10:253' },
      { id: 'c1', holder: 'Tartu TÜR', shelfmark: 'R Acad. Dorp. 1', reproduction: { kind: 'paberkoopia', of: 'o2' } },
      { id: 'c2', holder: 'Tartu TÜR', shelfmark: 'R Acad. Dorp. 2', reproduction: { kind: 'mikrofilm' } },
    ];
    const { container } = render(
      <ExemplarCards exemplars={list} pageNumbers={{}} archiveRefs={[]} archives={{}} />,
    );
    const notes = [...container.querySelectorAll('[data-testid="exemplar-notes"]')].map(n => n.textContent);
    expect(notes).toContain('exemplars.reproduction.kinds.paberkoopia: Uppsala UB Rar 10:253');
    expect(notes).toContain('exemplars.reproduction.kinds.mikrofilm');
  });

  it('laadimata: tuletatud viited ilma esiletõstuta', () => {
    render(
      <ExemplarCards exemplars={null} pageNumbers={{}} archiveRefs={[{ archive_id: 'Uppsala UB', reference: 'Rar 10:252' }]} archives={archives} />,
    );
    expect(screen.getByText('Rar 10:252')).toBeTruthy();
    expect(screen.queryByText('exemplars.witness')).toBeNull();
    expect(screen.queryByTestId('exemplar-cards')).toBeNull();
  });

  it('hoidja nimi on link eksemplari lehele; välislink sildiga kiibina', () => {
    const { container } = render(
      <MemoryRouter>
        <ExemplarCards exemplars={exemplars} pageNumbers={{}} archiveRefs={[]} archives={archives} workId="w1" />
      </MemoryRouter>,
    );
    const witness = screen.getAllByText('Uppsala UB')[0].closest('a');
    expect(witness?.getAttribute('href')).toBe('/work/w1/exemplar/ecb2kb');
    const ext = container.querySelector('a[href="https://www.ester.ee/record=b1510692"]');
    expect(ext?.textContent).toContain('ESTER');
  });

  it('töölaua leht avatud → link kannab ?page=N', () => {
    render(
      <MemoryRouter initialEntries={['/work/w1/7']}>
        <Routes>
          <Route path="/work/:workId/:pageNum?" element={
            <ExemplarCards exemplars={exemplars} pageNumbers={{}} archiveRefs={[]} archives={archives} workId="w1" />
          } />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Uppsala UB')[0].closest('a')?.getAttribute('href')).toBe('/work/w1/exemplar/ecb2kb?page=7');
  });

  it('ADA link → silt ADA; pildiriba pole, piltide arv tekstina', () => {
    const ada: Exemplar[] = [{ id: 'a1', holder: 'Tartu TÜR', url: 'http://hdl.handle.net/10062/14332' }];
    render(
      <MemoryRouter>
        <ExemplarCards exemplars={ada} pageNumbers={{}} archiveRefs={[]} archives={{}} workId="w1"
          images={{ a1: { count: 6, preview: ['p1', 'p2'] } }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/ADA/)).toBeTruthy();
    expect(screen.queryByTestId('exemplar-image-strip')).toBeNull();
    expect(screen.getByText(/exemplarImages\.count/).textContent).toContain('6');
  });
});
