/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { AttributionControl, type Map as MapLibreMap } from 'maplibre-gl';

describe('MapLibre attributsiooni turvaparandus', () => {
  it('eemaldab järjestikused ohtlikud atribuudid päris teegi renderduses', () => {
    // GHSA-jrc7-96c5-q579: elava attributes-loendi muutmisel jäi teine
    // sündmuseatribuut alles. Stub on ainult kaart; puhastus on päris teegist.
    const control = new AttributionControl({
      compact: false,
      customAttribution: '<details open onload="void(0)" ontoggle="void(0)">Test</details><a href="https://example.test">Allikas</a>',
    });
    const map = {
      on: vi.fn(), off: vi.fn(),
      _getUIString: () => 'Attribution',
      getCanvasContainer: () => document.createElement('div'),
      style: { tileManagers: {} },
    } as unknown as MapLibreMap;
    const element = control.onAdd(map);
    const details = element.querySelector('details details');
    expect(details).not.toBeNull();
    expect(details!.hasAttribute('onload')).toBe(false);
    expect(details!.hasAttribute('ontoggle')).toBe(false);
    expect(element.querySelector('a')?.getAttribute('href')).toBe('https://example.test');
    control.onRemove();
  });
});
