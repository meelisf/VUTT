/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCropBox } from '../useCropBox';

// Kleepuv kast ei tohi katta ootel kärbe kontuuri: `hasEdit` peidab selle (PageImageEditorModal).
// Reaalne stsenaarium: kasutaja joonistab ühel lehel kasti → suurus jääb meelde.
function hookWithDrawnBox() {
  const h = renderHook(() => useCropBox(400, 600, true));
  const overlay = document.createElement('div');
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  (h.result.current.overlayRef as { current: HTMLDivElement | null }).current = overlay;
  const at = (x: number, y: number) => ({ clientX: x, clientY: y });
  act(() => { h.result.current.onMouseDown({ ...at(50, 50), target: overlay, preventDefault() {} } as never); });
  act(() => { window.dispatchEvent(new MouseEvent('mousemove', at(250, 350))); });
  act(() => { window.dispatchEvent(new MouseEvent('mouseup', at(250, 350))); });
  return h;
}

describe('useCropBox kleepuv kast', () => {
  it('reset() paneb järgmisele lehele kleepuva kasti (see peidaks ootel kontuuri)', () => {
    const h = hookWithDrawnBox();
    expect(h.result.current.hasEdit).toBe(true);
    act(() => { h.result.current.reset(); });
    expect(h.result.current.hasEdit).toBe(true);
  });

  it('reset(false) ei pane kleepuvat kasti → ootel kärbe kontuur jääb nähtavaks', () => {
    const h = hookWithDrawnBox();
    act(() => { h.result.current.reset(false); });
    expect(h.result.current.cropRect).toBeNull();
    expect(h.result.current.hasEdit).toBe(false);
  });

  it('kleepuv suurus jääb reset(false) järel meelde', () => {
    const h = hookWithDrawnBox();
    act(() => { h.result.current.reset(false); });
    act(() => { h.result.current.reset(); });
    expect(h.result.current.hasEdit).toBe(true);
  });
});
