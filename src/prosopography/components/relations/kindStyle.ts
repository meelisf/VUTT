// src/prosopography/components/relations/kindStyle.ts
/**
 * Seose liigi värv ja kuju (#461, spekk „Palett"). Kolm tugevat liiki on valideeritud
 * paletist (3 slotti „all-pairs" vormidele); nõrgad on hallid ja eristuvad kujuga.
 * Värv ei ole kunagi ainus tunnus.
 */
import { createElement } from 'react';
import type { RelationKind } from '../../services/networkService';

export const KIND_COLOR: Record<RelationKind, string> = {
  academic: '#2a78d6',
  dedicated: '#eb6834',
  family: '#1baf7a',
  cotext: '#8a939d',
  mention: '#8a939d',
  printer: '#8a939d',
};

export function KindMark({ kind, r, x = 0, y = 0 }: { kind: RelationKind; r: number; x?: number; y?: number }) {
  const fill = KIND_COLOR[kind];
  const t = `translate(${x},${y})`;
  switch (kind) {
    case 'academic':
      return createElement('circle', { transform: t, r, fill, stroke: '#fff', strokeWidth: 1.5 });
    case 'dedicated':
      return createElement('rect', { transform: t, x: -r * 0.9, y: -r * 0.9, width: r * 1.8, height: r * 1.8, rx: 1.5, fill, stroke: '#fff', strokeWidth: 1.5 });
    case 'family':
      return createElement('path', { transform: t, d: `M0 ${-r * 1.2} ${r * 1.2} 0 0 ${r * 1.2} ${-r * 1.2} 0Z`, fill, stroke: '#fff', strokeWidth: 1.5 });
    case 'cotext':
      return createElement('circle', { transform: t, r: r * 0.8, fill });
    case 'mention':
      return createElement('circle', { transform: t, r: r * 0.75, fill: '#fff', stroke: fill, strokeWidth: 1.8 });
    default:
      return createElement('path', { transform: t, d: `M0 ${-r} ${r * 0.95} ${r * 0.75} ${-r * 0.95} ${r * 0.75}Z`, fill });
  }
}
