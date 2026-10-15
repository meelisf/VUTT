/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackEvent } from '../analytics';

afterEach(() => { delete (window as any).umami; });

describe('trackEvent', () => {
  it('kutsub umami.track-i', () => {
    const track = vi.fn();
    (window as any).umami = { track };
    trackEvent('filter-hint-accept', { kind: 'genre' });
    expect(track).toHaveBeenCalledWith('filter-hint-accept', { kind: 'genre' });
  });
  it('umami puudub → vaikne no-op', () => {
    expect(() => trackEvent('x')).not.toThrow();
  });
  it('umami viskab → neelatakse', () => {
    (window as any).umami = { track: () => { throw new Error('boom'); } };
    expect(() => trackEvent('x')).not.toThrow();
  });
});
