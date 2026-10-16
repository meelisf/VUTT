/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PageConflictDialog from '../PageConflictDialog';
import { PageStatus } from '../../../types';
import type { PageFields, TextChunk } from '../pageConflict';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'et' } }),
}));

const current: PageFields = {
  text_content: '', status: PageStatus.RAW, page_tags: [], comments: [], text_annotations: [],
};
const tükid: TextChunk[] = [
  { kind: 'ok', text: 'eel\n' },
  { kind: 'conflict', base: 'a\n', mine: 'minu rida\n', theirs: 'nende rida\n' },
  { kind: 'ok', text: 'vahe\n' },
  { kind: 'conflict', base: 'b', mine: 'MINU', theirs: '' },
];

const props = (over = {}) => ({
  conflict: { fields: ['text'], current, textChunks: tükid, theirsLast: { author: 'mari', date: '2026-10-16T10:00:00Z' } },
  onKeepMine: vi.fn(), onTakeTheirs: vi.fn(), onApplyChoices: vi.fn(), onCancel: vi.fn(), ...over,
});

describe('PageConflictDialog — tükkide valik (#612)', () => {
  it('rakenda on keelatud, kuni iga koht on valitud; annab valikud järjekorras', () => {
    const p = props();
    render(<PageConflictDialog {...p} />);
    const rakenda = screen.getByRole('button', { name: 'conflict.apply' });
    expect((rakenda as HTMLButtonElement).disabled).toBe(true);
    const raadiod = screen.getAllByRole('radio');
    expect(raadiod).toHaveLength(6);                  // 2 kohta × mõlemad/tema/minu
    fireEvent.click(raadiod[1]);                      // koht 1: tema
    expect((rakenda as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(raadiod[3]);                      // koht 2: mõlemad
    fireEvent.click(rakenda);
    expect(p.onApplyChoices).toHaveBeenCalledWith(['theirs', 'both']);
    expect(screen.queryByRole('button', { name: 'conflict.keepMine' })).toBeNull();
    // „Loobu minu muudatustest“ viskaks ära ka põrkumata parandused — tükkides seda pole.
    expect(screen.queryByRole('button', { name: 'conflict.takeTheirs' })).toBeNull();
  });

  it('kustutatud read on märgitud, mitte tühi kast', () => {
    render(<PageConflictDialog {...props()} />);
    expect(screen.getByText('conflict.emptyChunk')).toBeTruthy();
  });

  it('„Kõikjal minu" valib kõik kohad', () => {
    const p = props();
    render(<PageConflictDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'conflict.allMine' }));
    fireEvent.click(screen.getByRole('button', { name: 'conflict.apply' }));
    expect(p.onApplyChoices).toHaveBeenCalledWith(['mine', 'mine']);
  });

  it('tükkideta (vana server, ainult staatus) jääb tervikvalik', () => {
    render(<PageConflictDialog {...props({ conflict: { fields: ['status'], current } })} />);
    expect(screen.getByRole('button', { name: 'conflict.keepMine' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'conflict.takeTheirs' })).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
