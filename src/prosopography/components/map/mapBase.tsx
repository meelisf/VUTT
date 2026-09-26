// src/prosopography/components/map/mapBase.tsx
/**
 * Isikute kaartide ühine alus (#461): suur kaart (PersonsMap) ja isikulehe seoste kaart
 * (RelationsMap) kasutavad samu abilisi, et välimus ja käitumine ei lahkneks.
 */
import React, { useEffect } from 'react';
import { useMap } from 'react-leaflet';

export interface LatLon { lat: number; lon: number; }

export function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string | null {
  if (!labels) return null;
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? null;
}

const keyOf = (c: LatLon) => `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;

/** Täpselt kattuvad punktid laotakse väikesesse ringi, et kõik oleksid klõpsatavad. */
export function spreadOverlapping<T>(items: T[], coordsOf: (t: T) => LatLon) {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(coordsOf(it));
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return items.map(it => {
    const c = coordsOf(it);
    const group = groups.get(keyOf(c)) ?? [it];
    if (group.length <= 1) return { ...it, display: c, overlapped: false };
    const angle = (Math.PI * 2 * group.indexOf(it)) / group.length;
    const radius = 0.04 + Math.min(group.length, 8) * 0.003;
    return { ...it, display: { lat: c.lat + Math.sin(angle) * radius, lon: c.lon + Math.cos(angle) * radius }, overlapped: true };
  });
}

export function boundsOf(points: LatLon[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  return [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]];
}

export const FitToPoints: React.FC<{ points: LatLon[]; focus?: LatLon | null }> = ({ points, focus }) => {
  const map = useMap();
  useEffect(() => {
    // Laisalt laetud / vahekaardis kaart: Leaflet võis konteineri mõõta enne lõplikku
    // paigutust — ilma selleta arvutab fitBounds suumi vale suuruse järgi.
    map.invalidateSize({ animate: false });
    if (focus) { map.setView([focus.lat, focus.lon], 8, { animate: false }); return; }
    const b = boundsOf(points);
    if (b) map.fitBounds(b, { padding: [28, 28], maxZoom: 8, animate: false });
  }, [focus, map, points]);
  return null;
};
