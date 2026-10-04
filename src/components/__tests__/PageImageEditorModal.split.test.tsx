/** @vitest-environment jsdom */
/**
 * Pildiredaktori poolitus, pööre ja kärbe on OOTEL plaan (#431, ADR 0061): olek
 * tuleb teose halduse plaanist, mitte modaali enda olekust. Varem hoiti joont modaalis ja see
 * kadus sulgemisel — järgmine avamine algas jälle 50 % pealt.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import PageImageEditorModal from '../PageImageEditorModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { percent?: number }) => (o?.percent != null ? `${k}:${o.percent}` : k) }),
}));
vi.mock('../../contexts/UserContext', () => ({ useUser: () => ({ authToken: 't' }) }));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as never;
});

function renderModal(pendingOps = {}, initialTab: 'edit' | 'split' = 'split') {
  const onSplitChange = vi.fn();
  const onEditChange = vi.fn();
  const onAdjustClear = vi.fn();
  render(
    <PageImageEditorModal
      workId="w1" pages={[{ filename: 'a.jpg', page_num: 1 }, { filename: 'b.jpg', page_num: 2 }]}
      initialIndex={0} initialTab={initialTab}
      imageToken={null} onClose={vi.fn()} onPagesChanged={vi.fn(async () => ['a.jpg', 'b.jpg'])}
      onReplaceImage={vi.fn()} cacheBust={0}
      pendingOps={pendingOps} globalSplitX={0.5} onSplitChange={onSplitChange}
      onEditChange={onEditChange} onAdjustClear={onAdjustClear}
    />,
  );
  return Object.assign(onSplitChange, { onEditChange, onAdjustClear });
}

const ADJ = { angle: 0, crop: { x: 0.1, y: 0, w: 0.5, h: 1 }, quad: null };

describe('PageImageEditorModal poolitus', () => {
  it('lehekohane joon tuleb plaanist ka uuel avamisel', () => {
    renderModal({ 'a.jpg': { rotate: 0, split: true, split_x: 0.42 } });
    expect(screen.getByTestId('editor-split-state').textContent).toContain('manage.editor.splitAt:42');
  });

  it('„Ära poolita" saadab split:false (WorkManage kustutab ka joone, nagu upload\'i nosplit)', () => {
    const onSplitChange = renderModal({ 'a.jpg': { rotate: 0, split: true, split_x: 0.42 } });
    fireEvent.click(screen.getByTestId('editor-split-toggle'));
    expect(onSplitChange).toHaveBeenCalledWith('a.jpg', { split: false, split_x: 0.42 });
  });

  it('ootel toiminguta leht ei poolitu; „Poolita" märgib üldjoonele', () => {
    const onSplitChange = renderModal();
    expect(screen.getByTestId('editor-split-state').textContent).toContain('manage.editor.notSplit');
    fireEvent.click(screen.getByTestId('editor-split-toggle'));
    expect(onSplitChange).toHaveBeenCalledWith('a.jpg', { split: true, split_x: null });
  });
});

describe('PageImageEditorModal pööre ja kärbe on ootel plaan (ADR 0061)', () => {
  it('muutmata leht: nupp on „Järgmine", liigub edasi ega puuduta plaani', () => {
    const { onEditChange } = renderModal({}, 'edit');
    const btn = screen.getByTestId('editor-mark');
    expect(btn.textContent).toContain('manage.editor.next');
    fireEvent.click(btn);
    expect(onEditChange).not.toHaveBeenCalled();
    expect(screen.getByText('manage.editor.page')).toBeTruthy();
    // viimasel lehel pole kuhugi minna
    expect((screen.getByTestId('editor-mark') as HTMLButtonElement).disabled).toBe(true);
  });

  it('ootel kärbe on näha ja eemaldatav', () => {
    const { onAdjustClear } = renderModal({ 'a.jpg': { rotate: 90, split: false, adjust: ADJ } }, 'edit');
    expect(screen.getByTestId('editor-edit-pending').textContent).toContain('manage.editor.cropPending');
    fireEvent.click(screen.getByTestId('editor-crop-remove'));
    expect(onAdjustClear).toHaveBeenCalledWith('a.jpg');
  });

  it('pööre märgitakse plaani (kasti pole → kärbe kaob)', () => {
    const { onEditChange } = renderModal({}, 'edit');
    fireEvent.click(screen.getByTitle('pagePrep.rotateRight'));
    expect(screen.getByTestId('editor-mark').textContent).toContain('manage.editor.markAndNext');
    fireEvent.click(screen.getByTestId('editor-mark'));
    expect(onEditChange).toHaveBeenCalledWith('a.jpg', 90, null);
  });

  it('kärpega lehe poolitusvaade näitab serveri eelvaadet pöörde ja kärpega', () => {
    renderModal({ 'a.jpg': { rotate: 90, split: true, adjust: ADJ } });
    // Lava ilmub alles, kui peidetud laadija on pildi mõõtnud.
    fireEvent.load(document.querySelector('img.hidden')!);
    const src = (screen.getByTestId('editor-split-preview') as HTMLImageElement).getAttribute('src')!;
    expect(src).toContain('/admin/work/w1/page-image/a.jpg/preview?');
    expect(src).toContain('rot=90');
    expect(decodeURIComponent(src)).toContain('"crop":{"x":0.1');
    expect(src).toContain('size=view');
  });
});
