/** @vitest-environment jsdom */
/**
 * Kärbe/kalle/perspektiiv ja poolitus upload'i detailvaates (#431, ADR 0085).
 *
 * Leping, mida test hoiab:
 *  - üks vaade: kohandamata (pööratud) eelvaade, kärpekast ja poolitusjoon koos;
 *    joon kärpe raamis (pööre → adjust → poolitus);
 *  - „Näita tulemust" näitab KOHANDATUD eelvaadet (URL kannab `adj`);
 *  - kõik on kohe ootel: kasti muudatus ja joon lähevad plaani eraldi, kohe;
 *  - pööre eemaldab kärpe (eelmise raami koordinaadid), eemaldamine = null.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import SplitPageDetail from '../SplitPageDetail';
import type { PrepressPage, PrepressPlan } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'et' } }),
}));

beforeAll(() => {
  // jsdom ei paiguta: anna pildile mõõdud, et ülekatted renderduksid.
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} } as never;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) },
  );
});

const KÄRBE = { angle: 0, crop: { x: 0, y: 0, w: 0.5, h: 1 }, quad: null };

function plan(page: Partial<PrepressPage> = {}): PrepressPlan {
  return {
    default_split_x: 0.5, preview_status: 'ready', preview_done: 1, preview_cancel: false,
    page_count: 1, output_page_count: 1, trivial: true, status: 'awaiting_split', ocr_model: 'print',
    pages: [{ n: 1, mode: 'nosplit', split_x: null, excluded: false, rotate: 0, ...page }],
  } as PrepressPlan;
}

function renderDetail(p: PrepressPlan) {
  const onPageChange = vi.fn();
  const utils = render(
    <SplitPageDetail uploadId="u1" ticket={{ exp: 99, sig: "abc" }} plan={p} pageNum={1}
      onPageChange={onPageChange} onNavigate={vi.fn()} onClose={vi.fn()} />,
  );
  const img = () => utils.container.querySelector('img') as HTMLImageElement;
  return { ...utils, onPageChange, img };
}

/** Klõps pildil (ilma liikumiseta) kuvapikslites. */
const clickImage = (x: number, y: number) => {
  fireEvent.mouseDown(document.querySelector('.cursor-crosshair')!, { clientX: x, clientY: y });
  fireEvent.mouseUp(window, { clientX: x, clientY: y });
};

describe('SplitPageDetail üks vaade', () => {
  it('vahekaarte ei ole: kohandamata eelvaade, kärpekast ja tööriistad korraga', () => {
    const { img } = renderDetail(plan({ adjust: KÄRBE }));
    expect(screen.queryByTestId('editor-tab-split')).toBeNull();
    expect(img().src).not.toContain('adj=');
    expect(screen.getByTestId('detail-crop-area')).toBeTruthy();
    expect(screen.getByTestId('detail-toolbar')).toBeTruthy();
    expect(screen.getByTestId('detail-edit-pending')).toBeTruthy();
    // Pakkumist pole → „Kärbi ja järgmine" puudub; liikumine noolte kaudu.
    expect(screen.queryByTestId('detail-mark')).toBeNull();
    expect(screen.getByTestId('page-nav-position').textContent).toBe('1 / 1');
  });

  it('„Näita tulemust": kohandatud eelvaade, raam ja lukus tööriistad', () => {
    const { img } = renderDetail(plan({ adjust: KÄRBE }));
    expect(screen.queryByTestId('cropped-preview-mark')).toBeNull();
    fireEvent.click(screen.getByTestId('detail-result-toggle'));
    expect(img().src).toContain('adj=');
    expect(screen.getByTestId('cropped-preview-mark')).toBeTruthy();
    expect(screen.queryByTestId('detail-toolbar')).toBeNull();
    expect(screen.queryByTestId('detail-crop-area')).toBeNull();
  });

  it('kärbeta lehe tulemusel raami ei ole', () => {
    renderDetail(plan());
    fireEvent.click(screen.getByTestId('detail-result-toggle'));
    expect(screen.queryByTestId('cropped-preview-mark')).toBeNull();
  });

  it('ootel kärbe kontuur on nähtav; kärbeta lehel ei ole', () => {
    const first = renderDetail(plan({ adjust: KÄRBE }));
    expect(screen.getByTestId('detail-pending-outline')).toBeTruthy();
    first.unmount();
    renderDetail(plan());
    expect(screen.queryByTestId('detail-pending-outline')).toBeNull();
  });

  it('poolitataval lehel on joon kärpe raamis', () => {
    // Raam 400 px; kärbe x 0…0.5 → üldjoon 50 % = 100 px.
    renderDetail(plan({ mode: 'default', adjust: KÄRBE }));
    expect(Number(screen.getByTestId('detail-line').getAttribute('x1'))).toBeCloseTo(100);
  });

  it('poolitamata lehel joont ei ole ja klõps poolitust ei tekita', () => {
    const { onPageChange } = renderDetail(plan());
    expect(screen.queryByTestId('detail-line')).toBeNull();
    clickImage(200, 300);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('klõps paneb joone kärpe raamis', () => {
    const { onPageChange } = renderDetail(plan({ mode: 'default', adjust: KÄRBE }));
    clickImage(150, 300);   // 150 / 400 = 0.375 → kärpe raamis 0.375 / 0.5 = 0.75
    expect(onPageChange).toHaveBeenCalledWith(1, { mode: 'custom', split_x: 0.75 });
  });

  it('perspektiivi lüliti läheb KOHE plaani quad-i serveri kujul; klõps paneb ainult joone', () => {
    const { onPageChange } = renderDetail(plan({ mode: 'default' }));
    fireEvent.click(screen.getByTestId('detail-tool-perspective'));
    expect(onPageChange).toHaveBeenCalledTimes(1);
    const patch = onPageChange.mock.calls[0][1];
    expect(patch.adjust.crop).toBeNull();
    expect(patch.adjust.quad).toHaveLength(4);
    expect(Array.isArray(patch.adjust.quad[0])).toBe(true);
    clickImage(200, 300);
    expect(onPageChange).toHaveBeenCalledTimes(2);
    expect(Object.keys(onPageChange.mock.calls[1][1]).sort()).toEqual(['mode', 'split_x']);
  });

  it('pööre (ribal) eemaldab kärpe', () => {
    const { onPageChange } = renderDetail(plan({ adjust: KÄRBE }));
    fireEvent.click(screen.getByTestId('detail-rotate-right'));
    expect(onPageChange).toHaveBeenCalledWith(1, { rotate: 90, adjust: null });
  });

  it('kapsli ✕ eemaldab kärbe (null)', () => {
    const { onPageChange } = renderDetail(plan({ adjust: KÄRBE }));
    fireEvent.click(screen.getByTestId('detail-crop-remove'));
    expect(onPageChange).toHaveBeenCalledWith(1, { adjust: null });
  });

  it('pöörde ✕ eemaldab pöörde ja kärpe; poolituse ✕ ainult poolituse', () => {
    const { onPageChange } = renderDetail(plan({ rotate: 90, mode: 'custom', split_x: 0.4, adjust: KÄRBE }));
    fireEvent.click(screen.getByTestId('detail-rotate-remove'));
    expect(onPageChange).toHaveBeenLastCalledWith(1, { rotate: 0, adjust: null });
    fireEvent.click(screen.getByTestId('detail-split-remove'));
    expect(onPageChange).toHaveBeenLastCalledWith(1, { mode: 'nosplit', split_x: null });
  });

  it('„Välista leht" on päises', () => {
    const { onPageChange } = renderDetail(plan());
    fireEvent.click(screen.getByTestId('detail-exclude'));
    expect(onPageChange).toHaveBeenCalledWith(1, { excluded: true });
  });

  it('jalus: Tagasi ülevaatesse ja lehenooled on ühised', () => {
    renderDetail(plan());
    expect(screen.getByTestId('back-to-overview')).toBeTruthy();
    expect(screen.getByTestId('page-prev')).toBeTruthy();
    expect(screen.getByTestId('page-next')).toBeTruthy();
  });
});
