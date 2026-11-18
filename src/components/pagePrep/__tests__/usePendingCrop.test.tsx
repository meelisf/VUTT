/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCropBox } from '../useCropBox';
import { usePendingCrop } from '../usePendingCrop';
import type { PageAdjust } from '../../../pages/upload/types';

// ADR 0085: kõik on kohe ootel. Kasutaja muudatus läheb plaani, kleepuv kast (pakkumine)
// ei lähe, ootel kärbe taastatakse muudetava kastina ilma plaani kirjutamata.
function setup(pending: PageAdjust | null, key = 'p1') {
  const onCommit = vi.fn();
  const h = renderHook(({ adj, k }) => {
    const crop = useCropBox(400, 600, true);
    usePendingCrop({ crop, pendingAdjust: adj, pageKey: k, ready: true, onCommit });
    return crop;
  }, { initialProps: { adj: pending, k: key } });
  const overlay = document.createElement('div');
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  (h.result.current.overlayRef as { current: HTMLDivElement | null }).current = overlay;
  const drag = (target: HTMLElement, from: [number, number], to: [number, number]) => {
    act(() => { h.result.current.onMouseDown({ clientX: from[0], clientY: from[1], target, preventDefault() {} } as never); });
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: to[0], clientY: to[1] })); });
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { clientX: to[0], clientY: to[1] })); });
  };
  return { h, onCommit, overlay, drag };
}

const KÄRBE: PageAdjust = { angle: 0, crop: { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }, quad: null };

describe('usePendingCrop', () => {
  it('joonistatud kast läheb kohe plaani', () => {
    const { onCommit, overlay, drag } = setup(null);
    drag(overlay, [50, 50], [250, 350]);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].crop.w).toBeCloseTo(0.5);
  });

  it('ootel kärbe taastatakse kastina, plaani ei kirjutata', () => {
    const { h, onCommit } = setup(KÄRBE);
    expect(h.result.current.cropRect!.x).toBeCloseTo(0.25);
    expect(h.result.current.cropRect!.w).toBeCloseTo(0.5);
    expect(h.result.current.proposal).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('kleepuv kast on pakkumine — plaani ei lähe; puudutamisel läheb', () => {
    const { h, onCommit, overlay, drag } = setup(null);
    drag(overlay, [50, 50], [250, 350]);
    onCommit.mockClear();
    act(() => { h.result.current.reset(); });           // järgmine leht: pakkumine
    expect(h.result.current.proposal).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
    const box = document.createElement('div');
    box.dataset.cropbox = '';
    drag(box, [150, 300], [180, 300]);                   // liiguta → puudutatud
    expect(h.result.current.proposal).toBe(false);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('kasti eemaldamine (tööriistariba) kirjutab plaani null', () => {
    const { h, onCommit } = setup(KÄRBE);
    act(() => { h.result.current.clearCrop(); });
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('klõps (joon) ei kirjuta kärbet', () => {
    const { onCommit, overlay, drag } = setup(KÄRBE);
    drag(overlay, [380, 580], [380, 580]);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
