/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import CropOverlay from '../CropOverlay';
import type { CropBoxState } from '../useCropBox';

afterEach(cleanup);

// Ainult need väljad, mida CropOverlay loeb.
const cropAt = (cy: number, h: number) => ({
  overlayRef: { current: null },
  perspective: false,
  quad: null,
  cropDraft: null,
  displayW: 400,
  displayH: 600,
  overlayBox: { cx: 200, cy, w: 200, h, angle: 0 },
  onMouseDown: () => {},
}) as unknown as CropBoxState;

const handle = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-rotate]')!;

// 2026-11-18: pildi ülaservas olevalt kastilt jäi pöördesang lava taha.
describe('CropOverlay pöördesang', () => {
  it('ruumi olemasolul on sang kasti kohal', () => {
    const { container } = render(<CropOverlay crop={cropAt(300, 200)} deskewTitle="" />);
    expect(handle(container).dataset.inside).toBe('false');
    expect(handle(container).style.top).toBe('-22px');
  });

  it('pildi ülaservas olevalt kastilt läheb sang kasti sisse', () => {
    const { container } = render(<CropOverlay crop={cropAt(100, 200)} deskewTitle="" />);
    expect(handle(container).dataset.inside).toBe('true');
    expect(handle(container).style.top).toBe('22px');
  });
});
