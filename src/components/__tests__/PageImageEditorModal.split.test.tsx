/** @vitest-environment jsdom */
/**
 * Pildiredaktori poolitus, pööre ja kärbe on OOTEL plaan (#431, ADR 0061): olek
 * tuleb teose halduse plaanist, mitte modaali enda olekust. Varem hoiti joont modaalis ja see
 * kadus sulgemisel — järgmine avamine algas jälle 50 % pealt.
 * Üks vaade (ADR 0085): kärpekast ja poolitusjoon samal pildil, joon kärpe raamis.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import PageImageEditorModal from '../PageImageEditorModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { percent?: number }) => (o?.percent != null ? `${k}:${o.percent}` : k) }),
}));
vi.mock('../../contexts/UserContext', () => ({ useUser: () => ({ authToken: 't' }) }));
// Pilet (#764) on kohe olemas — päringut testis ei tehta.
vi.mock('../../hooks/useAdminImageTicket', () => ({ useAdminImageTicket: () => ({ exp: 99, sig: 'abc' }) }));

beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as never;
  // jsdom ei laadi pilte ega paiguta: pilt 400×600, iga element 600×400 raam (90° pööratud leht).
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 600 });
  // Lava 600×400 (mõõtmine lahutab 4 px varu).
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 604 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 404 });
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
});

/** Lava ilmub alles, kui peidetud laadija on pildi mõõtnud. */
const loadImage = () => fireEvent.load(document.querySelector('img.hidden')!);
/** Klõps pildil (ilma liikumiseta) kuvapikslites. */
const clickImage = (x: number, y: number) => {
  fireEvent.mouseDown(document.querySelector('.cursor-crosshair')!, { clientX: x, clientY: y });
  fireEvent.mouseUp(window, { clientX: x, clientY: y });
};

function renderModal(pendingOps = {}) {
  const onSplitChange = vi.fn();
  const onEditChange = vi.fn();
  const onAdjustClear = vi.fn();
  render(
    <PageImageEditorModal
      workId="w1" pages={[{ filename: 'a.jpg', page_num: 1 }, { filename: 'b.jpg', page_num: 2 }]}
      initialIndex={0}
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
    expect(screen.getByTestId('editor-split-state').textContent).toContain('pagePrep.splitAt:42');
  });

  it('„Ära poolita" saadab split:false (WorkManage kustutab ka joone, nagu upload\'i nosplit)', () => {
    const onSplitChange = renderModal({ 'a.jpg': { rotate: 0, split: true, split_x: 0.42 } });
    fireEvent.click(screen.getByTestId('editor-split-toggle'));
    expect(onSplitChange).toHaveBeenCalledWith('a.jpg', { split: false, split_x: 0.42 });
  });

  it('ootel toiminguta leht ei poolitu; „Poolita" märgib üldjoonele', () => {
    const onSplitChange = renderModal();
    expect(screen.getByTestId('editor-split-state').textContent).toContain('common:pagePrep.notSplit');
    fireEvent.click(screen.getByTestId('editor-split-toggle'));
    expect(onSplitChange).toHaveBeenCalledWith('a.jpg', { split: true, split_x: null });
  });
});

describe('PageImageEditorModal pööre ja kärbe on ootel plaan (ADR 0061)', () => {
  it('liikumine käib noolte kaudu ega puuduta plaani; „Järgmine" nuppu pole (ADR 0085)', () => {
    const { onEditChange } = renderModal({});
    expect(screen.queryByTestId('editor-mark')).toBeNull();     // pakkumist pole
    expect(screen.getByTestId('page-nav-position').textContent).toBe('1 / 2');
    fireEvent.click(screen.getByTestId('page-next'));
    expect(onEditChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('page-nav-position').textContent).toBe('2 / 2');
    // viimasel lehel pole kuhugi minna
    expect((screen.getByTestId('page-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('ootel kärbe on näha ja eemaldatav', () => {
    const { onAdjustClear } = renderModal({ 'a.jpg': { rotate: 90, split: false, adjust: ADJ } });
    expect(screen.getByTestId('editor-edit-pending').textContent).toContain('pagePrep.cropPending');
    fireEvent.click(screen.getByTestId('editor-crop-remove'));
    expect(onAdjustClear).toHaveBeenCalledWith('a.jpg');
  });

  it('pööre läheb KOHE plaani, kärbe kaob (ADR 0085)', () => {
    const { onEditChange } = renderModal({});
    fireEvent.click(screen.getByTitle('pagePrep.rotateRight'));
    expect(onEditChange).toHaveBeenCalledWith('a.jpg', 90, null);
    // Märkimist enam ei ole.
    expect(screen.queryByTestId('editor-mark')).toBeNull();
  });

  it('„Näita tulemust" näitab serveri eelvaadet pöörde ja kärpega (ADR 0085)', () => {
    renderModal({ 'a.jpg': { rotate: 90, split: true, adjust: ADJ } });
    loadImage();
    fireEvent.click(screen.getByTestId('editor-result-toggle'));
    const src = (screen.getByTestId('editor-result-image') as HTMLImageElement).getAttribute('src')!;
    expect(src).toContain('/admin/work/w1/page-image/a.jpg/preview?');
    expect(src).toContain('rot=90');
    expect(decodeURIComponent(src)).toContain('"crop":{"x":0.1');
    expect(src).toContain('size=view');
  });
});

describe('PageImageEditorModal tagasi ülevaatesse', () => {
  it('sulgeb modaali', () => {
    const onClose = vi.fn();
    render(
      <PageImageEditorModal
        workId="w1" pages={[{ filename: 'a.jpg', page_num: 1 }]} initialIndex={0}
        imageToken={null} onClose={onClose} onPagesChanged={vi.fn(async () => ['a.jpg'])}
        onReplaceImage={vi.fn()} cacheBust={0} pendingOps={{}} globalSplitX={0.5}
        onSplitChange={vi.fn()} onEditChange={vi.fn()} onAdjustClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('back-to-overview'));
    expect(onClose).toHaveBeenCalled();
  });
});

// „Rakenda kõik" rakendab AINULT plaani. Pööre ja kärbe on kohe plaanis (ADR 0085);
// puutumata kleepuv kast (pakkumine) ei lähe plaani — vt usePendingCrop.test.tsx.
describe('PageImageEditorModal „Rakenda kõik" ainult plaanist', () => {
  it('rakendab plaani; redaktor ise midagi juurde ei kirjuta', () => {
    const onEditChange = vi.fn();
    const onApplyAll = vi.fn();
    render(
      <PageImageEditorModal
        workId="w1" pages={[{ filename: 'a.jpg', page_num: 1 }, { filename: 'b.jpg', page_num: 2 }]}
        initialIndex={1}
        imageToken={null} onClose={vi.fn()} onPagesChanged={vi.fn(async () => ['a.jpg', 'b.jpg'])}
        onReplaceImage={vi.fn()} cacheBust={0}
        pendingOps={{ 'a.jpg': { rotate: 0, split: false, adjust: ADJ } }} globalSplitX={0.5}
        onSplitChange={vi.fn()} onEditChange={onEditChange} onAdjustClear={vi.fn()}
        onApplyAll={onApplyAll}
      />,
    );
    fireEvent.click(screen.getByTestId('editor-apply-all'));
    expect(onEditChange).not.toHaveBeenCalled();
    expect(onApplyAll).toHaveBeenCalledTimes(1);
  });
});

// ADR 0085: üks vaade — joon kärpe raamis, klõps paneb joone.
describe('PageImageEditorModal üks vaade', () => {
  it('vahekaarte ei ole; kärpe tööriistad ja joon on samal pildil', () => {
    renderModal({ 'a.jpg': { rotate: 90, split: true } });
    loadImage();
    expect(screen.queryByTestId('editor-tab-split')).toBeNull();
    expect(screen.getByTitle('pagePrep.rotateRight')).toBeTruthy();
    expect(screen.getByTestId('editor-split-line')).toBeTruthy();
  });

  it('ootel kärbega lehel on joon kärpe laiuse järgi', () => {
    // Raam 600×400; kärbe x 0.1…0.6 → joon 50 % = 0.35 × 600 = 210 px.
    renderModal({ 'a.jpg': { rotate: 90, split: true, adjust: ADJ } });
    loadImage();
    expect(Number(screen.getByTestId('editor-split-line').getAttribute('x1'))).toBeCloseTo(210);
  });

  it('klõps paneb joone kärpe raamis', () => {
    const onSplitChange = renderModal({ 'a.jpg': { rotate: 90, split: true, adjust: ADJ } });
    loadImage();
    clickImage(300, 200);   // 300/600 = 0.5 → kärpe raamis (0.5 - 0.1) / 0.5 = 0.8
    expect(onSplitChange).toHaveBeenCalledWith('a.jpg', { split: true, split_x: 0.8 });
  });

  it('poolitamata lehel klõps poolitust ei tekita', () => {
    const onSplitChange = renderModal({});
    loadImage();
    clickImage(300, 200);
    expect(onSplitChange).not.toHaveBeenCalled();
  });
});

// Lehe ootel muudatused on eraldi kiibid, igaühel oma ✕; „Rakenda kõik" on eraldi nupp.
describe('PageImageEditorModal lehe kiibid', () => {
  it('pöörde ✕ eemaldab pöörde (ja kärpe)', () => {
    const { onEditChange } = renderModal({ 'a.jpg': { rotate: 90, split: true, adjust: ADJ } });
    fireEvent.click(screen.getByTestId('editor-rotate-remove'));
    expect(onEditChange).toHaveBeenCalledWith('a.jpg', 0, null);
  });

  it('poolituse ✕ tühistab ainult poolituse', () => {
    const onSplitChange = renderModal({ 'a.jpg': { rotate: 90, split: true, split_x: 0.42, adjust: ADJ } });
    fireEvent.click(screen.getByTestId('editor-split-remove'));
    expect(onSplitChange).toHaveBeenCalledWith('a.jpg', { split: false, split_x: 0.42 });
    expect(onSplitChange.onEditChange).not.toHaveBeenCalled();
    expect(onSplitChange.onAdjustClear).not.toHaveBeenCalled();
  });

  it('„Rakenda kõik" ei ole lehe kiipide sees', () => {
    render(
      <PageImageEditorModal
        workId="w1" pages={[{ filename: 'a.jpg', page_num: 1 }]} initialIndex={0}
        imageToken={null} onClose={vi.fn()} onPagesChanged={vi.fn(async () => ['a.jpg'])}
        onReplaceImage={vi.fn()} cacheBust={0}
        pendingOps={{ 'a.jpg': { rotate: 90, split: false } }} globalSplitX={0.5}
        onSplitChange={vi.fn()} onEditChange={vi.fn()} onAdjustClear={vi.fn()} onApplyAll={vi.fn()}
      />,
    );
    const chips = screen.getByTestId('editor-edit-pending');
    expect(chips.contains(screen.getByTestId('editor-apply-all'))).toBe(false);
  });
});
