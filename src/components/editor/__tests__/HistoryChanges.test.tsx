/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HistoryChangeDetails } from '../HistoryChanges';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const changes = {
  text: false,
  text_annotations: { removed: [{ id: 3, text: 'vana märkus' }] },
  comments: { removed: [{ id: 'c1', text: 'lehe märge' }] },
};

const restore = (over = {}) => ({
  onRestore: vi.fn(), busy: false, restoringId: null, restoredIds: new Set<string>(), ...over,
});

describe('HistoryChangeDetails — märkus märkmena (#375 p4)', () => {
  it('nupp on ainult eemaldatud tekst-annotatsioonil ja annab numbrilise id', () => {
    const r = restore();
    render(<HistoryChangeDetails changes={changes} annotationRestore={r} />);
    const nupud = screen.getAllByRole('button', { name: 'history.changes.restoreAsComment' });
    expect(nupud).toHaveLength(1); // lehe märkmel on oma taastetee
    fireEvent.click(nupud[0]);
    expect(r.onRestore).toHaveBeenCalledWith(3);
  });

  it('numbriline id tunneb ära stringivõtmega taastatud oleku', () => {
    render(<HistoryChangeDetails changes={changes} annotationRestore={restore({ restoredIds: new Set(['3']) })} />);
    expect(screen.getByText('history.changes.restoredAsComment')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'history.changes.restoreAsComment' })).toBeNull();
  });

  it('taastamise ajal on nupp lukus ja näitab ootust', () => {
    render(<HistoryChangeDetails changes={changes} annotationRestore={restore({ busy: true, restoringId: '3' })} />);
    const nupp = screen.getByRole('button', { name: '…' }) as HTMLButtonElement;
    expect(nupp.disabled).toBe(true);
  });

  it('ilma õiguseta (readOnly) nuppu ei ole', () => {
    render(<HistoryChangeDetails changes={changes} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
