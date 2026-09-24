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
    <SplitPageDetail uploadId="u1" token="tok" plan={p} pageNum={1}
      onPageChange={onPageChange} onNavigate={vi.fn()} onClose={vi.fn()} />,
  );
  const img = () => utils.container.querySelector('img') as HTMLImageElement;
  return { ...utils, onPageChange, img };
}

describe('SplitPageDetail kärpimine', () => {
  it('kärbitud leht: tavavaade kannab adj-i, päis ütleb „kärbitud"', () => {
    const { img } = renderDetail(plan({ adjust: KÄRBE }));
    expect(img().src).toContain('adj=');
    expect(screen.getByTestId('detail-cropped')).toBeTruthy();
  });

  it('kärpimisrežiim näitab kohandamata eelvaadet ja kärpekasti', () => {
    const { img } = renderDetail(plan({ adjust: KÄRBE }));
    fireEvent.click(screen.getByTestId('detail-crop'));
    expect(img().src).not.toContain('adj=');
    expect(screen.getByTestId('detail-crop-area')).toBeTruthy();
    // Kasti veel ei ole → kinnitada ei saa.
    expect((screen.getByTestId('detail-crop-apply') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('detail-crop-cancel'));
    expect(screen.queryByTestId('detail-crop-area')).toBeNull();
  });

  it('perspektiiv + kinnitus kirjutab plaani quad-i serveri kujul', () => {
    const { onPageChange } = renderDetail(plan());
    fireEvent.click(screen.getByTestId('detail-crop'));
    fireEvent.click(screen.getByTestId('detail-perspective'));
    fireEvent.click(screen.getByTestId('detail-crop-apply'));
    const patch = onPageChange.mock.calls[0][1];
    expect(patch.adjust.crop).toBeNull();
    expect(patch.adjust.quad).toHaveLength(4);
    expect(Array.isArray(patch.adjust.quad[0])).toBe(true);
    expect(screen.queryByTestId('detail-crop-area')).toBeNull();
  });

  it('pööre eemaldab kärpe', () => {
    const { onPageChange } = renderDetail(plan({ adjust: KÄRBE }));
    fireEvent.click(screen.getByTestId('detail-rotate-right'));
    expect(onPageChange).toHaveBeenCalledWith(1, { rotate: 90, adjust: null });
  });

  it('„Eemalda kärbe" kirjutab null-i', () => {
    const { onPageChange } = renderDetail(plan({ adjust: KÄRBE }));
    fireEvent.click(screen.getByTestId('detail-crop-remove'));
    expect(onPageChange).toHaveBeenCalledWith(1, { adjust: null });
  });
});
