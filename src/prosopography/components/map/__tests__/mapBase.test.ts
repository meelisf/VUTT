/** @vitest-environment jsdom */
// src/prosopography/components/map/__tests__/mapBase.test.ts
import { describe, it, expect } from 'vitest';
import { boundsOf, resolveLabel, spreadOverlapping } from '../mapBase';

describe('mapBase', () => {
  it('resolveLabel: keel → et → en → esimene', () => {
    expect(resolveLabel({ et: 'Riia', en: 'Riga' }, 'en')).toBe('Riga');
    expect(resolveLabel({ en: 'Riga' }, 'et')).toBe('Riga');
    expect(resolveLabel(null, 'et')).toBeNull();
  });

  it('spreadOverlapping nihutab ainult kattuvaid', () => {
    const items = [{ id: 'a', c: { lat: 1, lon: 1 } }, { id: 'b', c: { lat: 1, lon: 1 } }, { id: 'c', c: { lat: 2, lon: 2 } }];
    const out = spreadOverlapping(items, i => i.c);
    expect(out.find(o => o.id === 'c')!.overlapped).toBe(false);
    expect(out.find(o => o.id === 'c')!.display).toEqual({ lat: 2, lon: 2 });
    const a = out.find(o => o.id === 'a')!;
    const b = out.find(o => o.id === 'b')!;
    expect(a.overlapped && b.overlapped).toBe(true);
    expect(a.display).not.toEqual(b.display);
  });

  it('boundsOf: tühi hulk → null (Leaflet fitBounds([]) viskab)', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ lat: 1, lon: 2 }, { lat: 3, lon: -1 }])).toEqual([[1, -1], [3, 2]]);
  });
});
