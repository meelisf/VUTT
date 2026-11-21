import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startVisibleInterval, VisibilityDoc } from '../visibleInterval';

/** Võltsdokument: nähtavust muudame käsitsi ja saadame sündmuse. */
function fakeDoc(state: DocumentVisibilityState = 'visible') {
  const listeners = new Set<() => void>();
  const doc: VisibilityDoc & { set(s: DocumentVisibilityState): void; count(): number } = {
    visibilityState: state,
    addEventListener: (_t, l) => { listeners.add(l); },
    removeEventListener: (_t, l) => { listeners.delete(l); },
    set(s) { this.visibilityState = s; listeners.forEach(l => l()); },
    count: () => listeners.size,
  };
  return doc;
}

describe('startVisibleInterval (#854)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const opts = (doc: VisibilityDoc, extra = {}) => ({ doc, now: () => Date.now(), ...extra });

  it('nähtaval vahekaardil: kohe üks kutse, siis intervalliga', () => {
    const fn = vi.fn();
    startVisibleInterval(fn, 60_000, opts(fakeDoc()));
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(180_000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('peidetud vahekaardil ei tule ühtki kutset', () => {
    const fn = vi.fn();
    const doc = fakeDoc();
    startVisibleInterval(fn, 60_000, opts(doc));
    doc.set('hidden');
    vi.advanceTimersByTime(10 * 60_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('peidetuna käivitatud: kutset ei tule enne ettetoomist', () => {
    const fn = vi.fn();
    const doc = fakeDoc('hidden');
    startVisibleInterval(fn, 60_000, opts(doc));
    vi.advanceTimersByTime(5 * 60_000);
    expect(fn).not.toHaveBeenCalled();
    doc.set('visible');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ettetoomisel kohe üks kutse ja intervall algab sealt uuesti', () => {
    const fn = vi.fn();
    const doc = fakeDoc();
    startVisibleInterval(fn, 60_000, opts(doc));
    vi.advanceTimersByTime(30_000);
    doc.set('hidden');
    vi.advanceTimersByTime(30_000);
    doc.set('visible');
    expect(fn).toHaveBeenCalledTimes(2);
    // Järgmine tick täis intervalli pärast ettetoomist, mitte vana graafiku järgi.
    vi.advanceTimersByTime(59_999);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('kiire edasi-tagasi klõpsamine ei tee kutset enne minGapMs-i', () => {
    const fn = vi.fn();
    const doc = fakeDoc();
    startVisibleInterval(fn, 60_000, opts(doc, { minGapMs: 5000 }));
    doc.set('hidden');
    vi.advanceTimersByTime(1000);
    doc.set('visible');
    expect(fn).toHaveBeenCalledTimes(1);
    doc.set('hidden');
    vi.advanceTimersByTime(5000);
    doc.set('visible');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('immediate=false: käivitusel kutset ei tule, ettetoomisel tuleb', () => {
    const fn = vi.fn();
    const doc = fakeDoc();
    startVisibleInterval(fn, 300_000, opts(doc, { immediate: false }));
    expect(fn).not.toHaveBeenCalled();
    doc.set('hidden');
    doc.set('visible');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('peatamine eemaldab taimeri ja kuulaja', () => {
    const fn = vi.fn();
    const doc = fakeDoc();
    const stop = startVisibleInterval(fn, 60_000, opts(doc));
    stop();
    expect(doc.count()).toBe(0);
    vi.advanceTimersByTime(5 * 60_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
