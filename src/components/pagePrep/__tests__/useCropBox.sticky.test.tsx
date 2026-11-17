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

// 2026-11-17: „Rakenda kõik" võttis järgmise lehe puutumata kleepuva kasti märkimata
// muudatusena plaani ja kärpis lehe, mida kasutaja ei tahtnud kärpida.
// Kaudsed salvestused (Rakenda kõik, vahekaardi vahetus) vaatavad `userEdited`-it.
describe('useCropBox userEdited', () => {
  it('puutumata kleepuv kast ei ole kasutaja muudatus', () => {
    const h = hookWithDrawnBox();
    expect(h.result.current.userEdited).toBe(true);
    act(() => { h.result.current.reset(); });
    expect(h.result.current.hasEdit).toBe(true);      // kast on näha
    expect(h.result.current.userEdited).toBe(false);  // aga keegi pole seda puudutanud
  });

  it('kleepuva kasti liigutamine teeb sellest kasutaja muudatuse', () => {
    const h = hookWithDrawnBox();
    act(() => { h.result.current.reset(); });
    const r = h.result.current.cropRect!;
    const overlay = h.result.current.overlayRef.current!;
    // Haara kasti seest (liigutus) ja nihuta.
    const cx = (r.x + r.w / 2) * 400, cy = (r.y + r.h / 2) * 600;
    act(() => { h.result.current.onMouseDown({ clientX: cx, clientY: cy, target: overlay, preventDefault() {} } as never); });
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: cx + 20, clientY: cy + 10 })); });
    act(() => { window.dispatchEvent(new MouseEvent('mouseup', { clientX: cx + 20, clientY: cy + 10 })); });
    expect(h.result.current.userEdited).toBe(true);
  });

  it('perspektiiv kleepuva kasti peal on kasutaja muudatus', () => {
    const h = hookWithDrawnBox();
    act(() => { h.result.current.reset(); });
    act(() => { h.result.current.togglePerspective(); });
    expect(h.result.current.userEdited).toBe(true);
  });

  it('kastita leht: userEdited on false', () => {
    const h = renderHook(() => useCropBox(400, 600, true));
    expect(h.result.current.userEdited).toBe(false);
  });
});
