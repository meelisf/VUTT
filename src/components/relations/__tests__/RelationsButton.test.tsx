/** @vitest-environment jsdom */
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
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
const getWorkExemplars = vi.fn();
vi.mock('../../../services/workApi', () => ({ getWorkExemplars: (...a: unknown[]) => getWorkExemplars(...a) }));
vi.mock('../../../contexts/UserContext', () => ({ useUser: () => ({ user: null, authToken: null }) }));

import RelationsButton from '../RelationsButton';

const V = (id: string): Relation => ({ id, rel_type: 'isVersionOf' });

function Harness({ relations, variant = 'card', onRowClick, convoluteCount }:
  { relations?: Relation[]; variant?: 'card' | 'row'; onRowClick?: () => void; convoluteCount?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <div onClick={onRowClick} style={{ position: 'relative' }}>
        <RelationsButton workId="w1" relations={relations} convoluteCount={convoluteCount} variant={variant} lang="et" open={open} onOpenChange={setOpen} />
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
    getWorkExemplars.mockReset();
    getWorkExemplars.mockResolvedValue({ exemplars: [], convolutes: [{
      exemplar_id: 'a', key: 'tür:r 1', holder: 'TÜR', reference: 'R 1', total: 2,
      members: [
        { work_id: 'w1', exemplar_id: 'a', position: 0, title: 'See teos', readable: true, current: true },
        { work_id: 'w9', exemplar_id: 'z', position: 1, title: 'Kaaslane w9', readable: true, current: false },
      ],
    }] });
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

  it('ainult konvoluudiga teosel on nupp; avamine laeb plokid, seoseid ei küsi (#702)', async () => {
    render(<Harness relations={[]} convoluteCount={1} />);
    const btn = screen.getByRole('button', { name: 'common:convolute.title' });
    expect(screen.getByTestId('convolute-indicator')).toBeTruthy();
    fireEvent.click(btn);
    await flush(0);
    expect(fetchRelations).not.toHaveBeenCalled();
    expect(getWorkExemplars).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Kaaslane w9')).toBeTruthy();
  });

  it('variant + konvoluut: mõlemad lõigud ülekattes', async () => {
    render(<Harness relations={[V('w2')]} convoluteCount={1} />);
    fireEvent.click(button());
    await flush(0);
    expect(screen.getByText('Teos w2')).toBeTruthy();
    expect(screen.getByText('Kaaslane w9')).toBeTruthy();
  });

  it('tühi konvoluudivastus: üksinda teade, seoste kõrval lõik ära', async () => {
    getWorkExemplars.mockResolvedValue({ exemplars: [], convolutes: [] });
    render(<Harness relations={[]} convoluteCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'common:convolute.title' }));
    await flush(0);
    expect(screen.getByTestId('convolute-unavailable')).toBeTruthy();
    cleanup();

    render(<Harness relations={[V('w2')]} convoluteCount={1} />);
    fireEvent.click(button());
    await flush(0);
    expect(screen.getByText('Teos w2')).toBeTruthy();
    // Nupu sr-only silt jääb; ülekattes konvoluudi pealkirja ei ole
    expect(screen.queryAllByText('common:convolute.title').filter(e => !e.classList.contains('sr-only'))).toHaveLength(0);
    expect(screen.queryByTestId('convolute-unavailable')).toBeNull();
  });

  it('konvoluudita teosel exemplars-päringut ei tehta', async () => {
    render(<Harness relations={[V('w2')]} />);
    fireEvent.click(button());
    await flush(0);
    expect(getWorkExemplars).not.toHaveBeenCalled();
  });
});
