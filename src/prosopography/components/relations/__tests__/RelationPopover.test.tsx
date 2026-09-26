// src/prosopography/components/relations/__tests__/RelationPopover.test.tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import './testI18n';
import RelationPopover, { usePopover } from '../RelationPopover';
import { applyFilters, DEFAULT_FILTER } from '../../../utils/network';
import type { PersonNetwork } from '../../../services/networkService';

const F = 'vutt:Pfocus';
const NET: PersonNetwork = {
  focus: { id: F, label: 'Johann Fischer', birth_year: 1636, death_year: 1705, origin: null },
  persons: [{ id: 'vutt:Ps', label: 'Johann Leonhard Schwäger', birth_year: null, death_year: null, origin: null }],
  works: [
    { work_id: 'jy30do', title: 'Legitimum Certamen', year: 1659, place: { id: 'Q1', label: 'Altdorf', coordinates: null }, genres: [], restricted: false },
    { work_id: 'sal', title: 'Salajane teos', year: 1660, place: null, genres: [], restricted: true },
  ],
  edges: [
    { kind: 'dedicated', from: 'vutt:Ps', to: F, directed: true, year: 1659, place: null,
      roles: { 'vutt:Ps': ['auctor'], [F]: ['subject'] }, evidence: { work_id: 'jy30do', pages: [] } },
    { kind: 'mention', from: 'vutt:Ps', to: F, directed: false, year: 1660, place: null,
      roles: { 'vutt:Ps': ['praeses'], [F]: ['mentioned'] }, evidence: { work_id: 'sal', pages: [2] } },
  ],
};

function renderPopover(pinned: boolean) {
  const net = applyFilters(NET, DEFAULT_FILTER);
  return render(
    <MemoryRouter>
      <RelationPopover state={{ personId: 'vutt:Ps', x: 10, y: 10, pinned }} net={net} onClose={() => {}} />
    </MemoryRouter>,
  );
}

describe('RelationPopover', () => {
  it('rollid nimedega, mitte „tema/fookus"', () => {
    renderPopover(false);
    expect(screen.getAllByText(/Schwäger/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fischer:/).length).toBe(2);
  });

  it('hõljutusel linke ei ole, kinnitatult on isikuleht ja teos', () => {
    const { unmount } = renderPopover(false);
    expect(screen.queryByRole('link')).toBeNull();
    unmount();
    renderPopover(true);
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toContain('/persons/vutt:Ps');
    expect(hrefs).toContain('/work/jy30do/1');
  });

  it('piiratud teos: lingita, märkega kaitstud; lehekülg näidatud', () => {
    renderPopover(true);
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs.some(h => h?.includes('/work/sal'))).toBe(false);
    expect(screen.getByText(/kaitstud/)).toBeTruthy();
    expect(screen.getByText(/lk 2/)).toBeTruthy();
  });
});

describe('usePopover', () => {
  const ev = { clientX: 5, clientY: 6, stopPropagation() {} } as unknown as React.MouseEvent;

  it('kinnitatud hüpik ei muutu hõljutusel ega kao lahkumisel; Esc sulgeb', () => {
    const { result } = renderHook(() => usePopover());
    act(() => result.current.pin('a', ev));
    act(() => result.current.hover('b', ev));
    act(() => result.current.leave());
    expect(result.current.state).toMatchObject({ personId: 'a', pinned: true });
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(result.current.state).toBeNull();
  });
});

describe('usePopover jõudlus', () => {
  it('liikumine sama isiku peal ei loo uut olekut (sektsioon ei renderda uuesti)', () => {
    const { result } = renderHook(() => usePopover());
    const ev1 = { clientX: 5, clientY: 6 } as unknown as React.MouseEvent;
    const ev2 = { clientX: 9, clientY: 12 } as unknown as React.MouseEvent;
    act(() => result.current.hover('a', ev1));
    const first = result.current.state;
    act(() => result.current.hover('a', ev2));
    expect(result.current.state).toBe(first);
    act(() => result.current.hover('b', ev2));
    expect(result.current.state).toMatchObject({ personId: 'b', x: 9, y: 12 });
  });
});

describe('RelationPopover „veel N teost" käändub', () => {
  it('üks lisateos → ainsus', () => {
    const works = Array.from({ length: 5 }, (_, i) => ({ work_id: `x${i}`, title: `T${i}`, year: 1650 + i, place: null, genres: [], restricted: false }));
    const edges = works.map(w => ({ kind: 'cotext' as const, from: 'vutt:Ps', to: F, directed: false, year: w.year, place: null,
      roles: { 'vutt:Ps': ['gratulator'], [F]: ['auctor'] }, evidence: { work_id: w.work_id, pages: [] } }));
    const net = applyFilters({ ...NET, works, edges }, DEFAULT_FILTER);
    render(<MemoryRouter><RelationPopover state={{ personId: 'vutt:Ps', x: 1, y: 1, pinned: false }} net={net} onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByText('… veel 1 teos')).toBeTruthy();
  });
});

describe('liitmärgi hüpik: ainult selle aasta teosed', () => {
  it('state.year piirab teoste loendi sellele aastale', () => {
    const net = applyFilters(NET, DEFAULT_FILTER);                   // jy30do 1659, sal 1660
    render(<MemoryRouter><RelationPopover state={{ personId: 'vutt:Ps', x: 1, y: 1, pinned: true, year: 1659 }} net={net} onClose={() => {}} /></MemoryRouter>);
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'));
    expect(hrefs).toContain('/work/jy30do/1');
    expect(screen.queryByText(/Salajane teos/)).toBeNull();
  });

  it('usePopover.pin aastaga salvestab aasta', () => {
    const { result } = renderHook(() => usePopover());
    const ev = { clientX: 1, clientY: 2, stopPropagation() {} } as unknown as React.MouseEvent;
    act(() => result.current.pin('a', ev, 1659));
    expect(result.current.state).toMatchObject({ personId: 'a', pinned: true, year: 1659 });
  });
});
