/** @vitest-environment jsdom */
/**
 * Kärbe/kalle/perspektiiv upload'i detailvaates (#431, etapp 2).
 *
 * Leping, mida test hoiab:
 *  - tavavaade näitab KOHANDATUD eelvaadet (URL kannab `adj`), et poolitusjoon
 *    asetuks nagu apply lõikab (pööre → adjust → poolitus);
 *  - kärpimisrežiim näitab kohandamata eelvaadet ja ühist kärpekasti;
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

const toEditTab = () => fireEvent.click(screen.getByTestId('editor-tab-edit'));

describe('SplitPageDetail vahekaardid ja kärpimine', () => {
  it('avaneb „Poolita" vahekaardil: kärbitud leht kannab adj-i ja ootel-kapslit', () => {
    const { img } = renderDetail(plan({ adjust: KÄRBE }));
    expect(img().src).toContain('adj=');
    expect(screen.getByTestId('detail-edit-pending')).toBeTruthy();
    expect(screen.queryByTestId('detail-toolbar')).toBeNull();
  });

  it('„Pööra ja kärbi" näitab kohandamata eelvaadet, kärpekasti ja ühist riba', () => {
    const { img } = renderDetail(plan({ adjust: KÄRBE }));
    toEditTab();
    expect(img().src).not.toContain('adj=');
    expect(screen.getByTestId('detail-crop-area')).toBeTruthy();
    expect(screen.getByTestId('detail-toolbar')).toBeTruthy();
    // Kasti veel pole ja see on ainus leht → märkida pole midagi.
    expect((screen.getByTestId('detail-mark') as HTMLButtonElement).disabled).toBe(true);
  });

  it('ootel kärbe kontuur on nähtav; kärbeta lehel ei ole', () => {
    renderDetail(plan({ adjust: KÄRBE }));
    toEditTab();
    expect(screen.getByTestId('detail-pending-outline')).toBeTruthy();
  });

  it('kärbeta lehel kontuuri ei ole', () => {
    renderDetail(plan());
    toEditTab();
    expect(screen.queryByTestId('detail-pending-outline')).toBeNull();
  });

  it('perspektiiv + „Märgi" kirjutab plaani quad-i serveri kujul', () => {
    const { onPageChange } = renderDetail(plan());
    toEditTab();
    fireEvent.click(screen.getByTestId('detail-tool-perspective'));
    fireEvent.click(screen.getByTestId('detail-mark'));
    const patch = onPageChange.mock.calls[0][1];
    expect(patch.adjust.crop).toBeNull();
    expect(patch.adjust.quad).toHaveLength(4);
    expect(Array.isArray(patch.adjust.quad[0])).toBe(true);
  });

  it('vahekaardi vahetus kirjutab märkimata kasti plaani (nagu halduses)', () => {
    const { onPageChange } = renderDetail(plan());
    toEditTab();
    fireEvent.click(screen.getByTestId('detail-tool-perspective'));
    fireEvent.click(screen.getByTestId('editor-tab-split'));
    expect(onPageChange.mock.calls[0][1].adjust.quad).toHaveLength(4);
  });

  it('pööre (ribal) eemaldab kärpe', () => {
    const { onPageChange } = renderDetail(plan({ adjust: KÄRBE }));
    toEditTab();
    fireEvent.click(screen.getByTestId('detail-rotate-right'));
    expect(onPageChange).toHaveBeenCalledWith(1, { rotate: 90, adjust: null });
  });

  it('kapsli ✕ eemaldab kärbe (null)', () => {
    const { onPageChange } = renderDetail(plan({ adjust: KÄRBE }));
    fireEvent.click(screen.getByTestId('detail-crop-remove'));
    expect(onPageChange).toHaveBeenCalledWith(1, { adjust: null });
  });

  it('„Välista leht" on päises mõlemal vahekaardil', () => {
    const { onPageChange } = renderDetail(plan());
    fireEvent.click(screen.getByTestId('detail-exclude'));
    expect(onPageChange).toHaveBeenCalledWith(1, { excluded: true });
    toEditTab();
    expect(screen.getByTestId('detail-exclude')).toBeTruthy();
  });

  it('jalus: Tagasi ülevaatesse ja lehenooled on ühised', () => {
    renderDetail(plan());
    expect(screen.getByTestId('back-to-overview')).toBeTruthy();
    expect(screen.getByTestId('page-prev')).toBeTruthy();
    expect(screen.getByTestId('page-next')).toBeTruthy();
  });
});
