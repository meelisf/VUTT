/** @vitest-environment jsdom */
/**
 * Pildiredaktori poolitus on OOTEL plaan (#431): olek tuleb teose halduse
 * plaanist, mitte modaali enda olekust. Varem hoiti joont modaalis ja see
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

function renderModal(pendingOps = {}) {
  const onSplitChange = vi.fn();
  render(
    <PageImageEditorModal
      workId="w1" pages={[{ filename: 'a.jpg', page_num: 1 }]} initialIndex={0} initialTab="split"
      imageToken={null} onClose={vi.fn()} onPagesChanged={vi.fn(async () => ['a.jpg'])}
      onReplaceImage={vi.fn()} cacheBust={0}
      pendingOps={pendingOps} globalSplitX={0.5} onSplitChange={onSplitChange}
    />,
  );
  return onSplitChange;
}

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
