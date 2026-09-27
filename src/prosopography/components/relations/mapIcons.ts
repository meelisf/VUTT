// src/prosopography/components/relations/mapIcons.ts
/**
 * Seoste kaardi markerite ikoonid (#461). Mälus võtme järgi: react-leaflet võrdleb
 * ikoone identiteedi järgi ja kutsus uue objekti korral igal renderdusel setIcon-it.
 */
import { divIcon, type DivIcon } from 'leaflet';
import { KIND_ORDER } from '../../utils/network';
import { KIND_COLOR } from './kindStyle';

const cache = new Map<string, DivIcon>();

function memo(key: string, make: () => DivIcon): DivIcon {
  let icon = cache.get(key);
  if (!icon) {
    icon = make();
    cache.set(key, icon);
  }
  return icon;
}

/** Päritolukoha ring: täidis näitab seose liikide jaotust, keskel isikute arv. */
export function pieIcon(kinds: Partial<Record<string, number>>, count: number): DivIcon {
  const key = `pie|${count}|${KIND_ORDER.map(k => kinds[k] ?? 0).join(',')}`;
  return memo(key, () => {
    const total = Object.values(kinds).reduce<number>((a, b) => a + (b ?? 0), 0) || 1;
    let acc = 0;
    const stops = KIND_ORDER.filter(k => kinds[k]).map(k => {
      const from = (acc / total) * 100;
      acc += kinds[k] ?? 0;
      return `${KIND_COLOR[k]} ${from}% ${(acc / total) * 100}%`;
    }).join(', ');
    const size = count >= 20 ? 40 : count >= 10 ? 34 : count >= 3 ? 29 : 24;
    return divIcon({
      className: '',
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);background:conic-gradient(${stops});display:flex;align-items:center;justify-content:center;color:#fff;font:600 11px system-ui;text-shadow:0 0 2px #000">${count}</div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
    });
  });
}

/** Ümar märk numbri või sümboliga (trükikoht, elukäigu jaam, fookus). */
export function dotIcon(label: string | number, fill: string, hollow = false, size = 22): DivIcon {
  return memo(`dot|${label}|${fill}|${hollow}|${size}`, () => divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${hollow ? fill : '#fff'};background:${hollow ? '#fff' : fill};box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:${hollow ? fill : '#fff'};font:600 11px system-ui">${label}</div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
  }));
}
