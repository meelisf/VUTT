/** @vitest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Relation } from '../../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
const fetchRelations = vi.fn();
vi.mock('../../../services/relationsService', async (orig) => ({
  ...(await orig<typeof import('../../../services/relationsService')>()),
  fetchRelations: (...a: unknown[]) => fetchRelations(...a),
}));
vi.mock('../../../contexts/UserContext', () => ({ useUser: () => ({ user: null, authToken: null }) }));

import RelationsButton from '../RelationsButton';

const V = (id: string): Relation => ({ id, rel_type: 'isVersionOf' });

function Harness({ relations, variant = 'card', onRowClick }:
  { relations?: Relation[]; variant?: 'card' | 'row'; onRowClick?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <div onClick={onRowClick} style={{ position: 'relative' }}>
        <RelationsButton workId="w1" relations={relations} variant={variant} lang="et" open={open} onOpenChange={setOpen} />
      </div>
    </MemoryRouter>
  );
}

const button = () => screen.getByRole('button', { name: /Seotud teosed/ });
const flush = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

describe('RelationsButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchRelations.mockReset();
    fetchRelations.mockResolvedValue([{ id: 'w2', rel_type: 'isVersionOf', title: 'Teos w2', readable: true }]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('ainult isPartOf seosega teosel nuppu ei ole', () => {
    render(<Harness relations={[{ id: 'x', rel_type: 'isPartOf' }]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('number on isVersionOf seoste arv segaloendis', () => {
    render(<Harness relations={[V('a'), V('b'), { id: 'c', rel_type: 'isPartOf' }]} />);
    expect(button().textContent).toContain('2');
  });

  it('esimene avamine teeb ühe päringu, teine mitte', async () => {
    render(<Harness relations={[V('w2')]} />);
    fireEvent.click(button());
    await flush(0);
    expect(screen.getByText('Teos w2')).toBeTruthy();
    fireEvent.click(button());
    fireEvent.click(button());
    await flush(0);
    expect(fetchRelations).toHaveBeenCalledTimes(1);
  });

  it('hiir liigub nupult ülekattele — ülekate jääb lahti', async () => {
    render(<Harness relations={[V('w2')]} />);
    fireEvent.mouseEnter(button());
    await flush(250);
    const overlay = screen.getByTestId('relations-overlay');
    fireEvent.mouseLeave(button());
    fireEvent.mouseEnter(overlay);
    await flush(500);
    expect(screen.queryByTestId('relations-overlay')).not.toBeNull();
    fireEvent.mouseLeave(overlay);
    await flush(500);
    expect(screen.queryByTestId('relations-overlay')).toBeNull();
  });

  it('Esc sulgeb', async () => {
    render(<Harness relations={[V('w2')]} />);
    fireEvent.click(button());
    await flush(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    await flush(0);
    expect(screen.queryByTestId('relations-overlay')).toBeNull();
  });

  it('row: klõps nupul ja popoveris ei kutsu rea onClick-i', async () => {
    const onRowClick = vi.fn();
    render(<Harness relations={[V('w2')]} variant="row" onRowClick={onRowClick} />);
    fireEvent.click(button());
    await flush(0);
    fireEvent.click(screen.getByTestId('relations-overlay'));
    fireEvent.click(screen.getByText('Teos w2'));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
