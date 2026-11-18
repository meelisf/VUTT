/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCropBox } from '../useCropBox';

// ADR 0085: klõps ilma liikumiseta = poolitusjoon; kast ei tohi muutuda.
function setup() {
  const onClick = vi.fn();
  const h = renderHook(() => useCropBox(400, 600, true, { onClick }));
  const overlay = document.createElement('div');
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  (h.result.current.overlayRef as { current: HTMLDivElement | null }).current = overlay;
  const at = (x: number, y: number) => ({ clientX: x, clientY: y });
  const press = (target: HTMLElement, from: [number, number], to: [number, number]) => {
    act(() => { h.result.current.onMouseDown({ ...at(...from), target, preventDefault() {} } as never); });
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', at(...to))); });
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', at(...to))); });
  };
  const box = document.createElement('div');
  box.dataset.cropbox = '';
  return { h, onClick, overlay, box, press };
}

describe('useCropBox klõps', () => {
  it('klõps tühjal alal kutsub onClick-i ega joonista kasti', () => {
    const { h, onClick, overlay, press } = setup();
    press(overlay, [100, 200], [101, 201]);
    expect(onClick).toHaveBeenCalledWith({ x: 100, y: 200 });
    expect(h.result.current.cropRect).toBeNull();
  });

  it('klõps tühjal alal EI kustuta olemasolevat kasti', () => {
    const { h, onClick, overlay, press } = setup();
    press(overlay, [50, 50], [250, 350]);           // joonista kast
    const r = h.result.current.cropRect;
    press(overlay, [380, 580], [380, 580]);         // klõps kastist väljas
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(h.result.current.cropRect).toBe(r);
  });

  it('klõps kasti sees ei nihuta kasti ega tee sellest kasutaja muudatust', () => {
    const { h, onClick, overlay, box, press } = setup();
    press(overlay, [50, 50], [250, 350]);
    act(() => { h.result.current.toggleCarry(); });
    act(() => { h.result.current.reset(); });       // kleepuv pakkumine, puutumata
    expect(h.result.current.proposal).toBe(true);
    const r = h.result.current.cropRect;
    expect(h.result.current.userEdited).toBe(false);
    press(box, [200, 300], [202, 301]);             // alla klõpsuläve
    expect(onClick).toHaveBeenCalledWith({ x: 200, y: 300 });
    expect(h.result.current.cropRect).toBe(r);
    expect(h.result.current.userEdited).toBe(false);
  });

  it('lohistus üle läve joonistab kasti, onClick-i ei kutsuta', () => {
    const { h, onClick, overlay, press } = setup();
    press(overlay, [50, 50], [250, 350]);
    expect(onClick).not.toHaveBeenCalled();
    expect(h.result.current.cropRect).not.toBeNull();
  });
});
