// src/prosopography/components/relations/RelationsGraph.tsx
/**
 * Radiaalne ego-võrgustik (#461, „Kes kellega"): fookus keskel, seotud isikud ringil
 * liigi ja esimese aasta järgi. Joone jämedus ja sõlme suurus = unikaalsed ühised teosed.
 * Hallid kaared = isikud, kes esinevad omavahel samas teoses (lülitatav).
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VisibleNetwork } from '../../utils/network';
import { coEdges, radialLayout, STRONG } from '../../utils/network';
import { KIND_COLOR, KindMark } from './kindStyle';
import type { usePopover } from './RelationPopover';

interface Props {
  net: VisibleNetwork;
  popover: ReturnType<typeof usePopover>;
  highlight: string | null;
  onHighlight: (id: string | null) => void;
}

const RelationsGraph: React.FC<Props> = ({ net, popover, highlight, onHighlight }) => {
  const { t } = useTranslation(['prosopography']);
  const [showCo, setShowCo] = useState(true);
  const many = net.persons.length > 40;
  const size = { w: 900, h: many ? 760 : 600 };
  const layout = useMemo(() => radialLayout(net, size), [net, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = useMemo(() => new Map(layout.nodes.map(n => [n.person.id, n])), [layout]);
  const co = useMemo(() => (showCo ? coEdges(net) : []), [net, showCo]);
  const maxW = Math.max(1, ...net.persons.map(p => p.workCount));
  const dim = (ids: string[]) => (highlight && !ids.includes(highlight) ? 0.12 : 1);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="inline-flex overflow-hidden rounded border border-gray-200 text-xs">
          <button type="button" onClick={() => setShowCo(true)} aria-pressed={showCo}
            className={`px-2.5 py-1 ${showCo ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>{t('network.coLines')}</button>
          <button type="button" onClick={() => setShowCo(false)} aria-pressed={!showCo}
            className={`border-l border-gray-200 px-2.5 py-1 ${!showCo ? 'bg-gray-800 text-white' : 'bg-white text-gray-600'}`}>{t('network.focusOnly')}</button>
        </div>
      </div>
      <svg viewBox={`0 0 ${size.w} ${size.h}`} className="h-auto w-full" role="img"
        aria-label={`${net.focus.label}: ${t('network.persons', { count: net.persons.length })}`}>
        <g fill="none">
          {co.map(c => {
            const a = pos.get(c.a); const b = pos.get(c.b);
            if (!a || !b) return null;
            const mx = layout.cx + (a.x + b.x - 2 * layout.cx) * 0.25;
            const my = layout.cy + (a.y + b.y - 2 * layout.cy) * 0.25;
            return <path key={`${c.a}|${c.b}`} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
              stroke="#9aa3ad" strokeOpacity={(many ? 0.22 : 0.45) * dim([c.a, c.b])} strokeWidth={Math.min(3, 0.8 + c.weight * 0.4)} />;
          })}
        </g>
        <g>
          {layout.nodes.map(n => (
            <line key={n.person.id} x1={layout.cx} y1={layout.cy} x2={n.x} y2={n.y}
              stroke={KIND_COLOR[n.person.kind]} strokeOpacity={(STRONG.has(n.person.kind) ? 0.55 : 0.3) * dim([n.person.id])}
              strokeWidth={1 + (n.person.workCount / maxW) * 4}
              strokeDasharray={n.person.kind === 'family' ? '4 3' : n.person.kind === 'mention' ? '2 3' : undefined} />
          ))}
        </g>
        <g>
          {layout.nodes.map(n => {
            const flip = Math.cos(n.angle) < 0;
            const deg = (n.angle * 180) / Math.PI;
            return (
              <g key={n.person.id} data-testid={`node-${n.person.id}`} style={{ cursor: 'pointer', opacity: dim([n.person.id]) }}
                onMouseEnter={e => { onHighlight(n.person.id); popover.hover(n.person.id, e); }}
                onMouseMove={e => popover.hover(n.person.id, e)}
                onMouseLeave={() => { onHighlight(null); popover.leave(); }}
                onClick={e => { onHighlight(n.person.id); popover.pin(n.person.id, e); }}>
                <circle cx={n.x} cy={n.y} r={14} fill="transparent" />
                <KindMark kind={n.person.kind} r={n.r} x={n.x} y={n.y} />
                {n.labelled && (
                  <text x={n.x} y={n.y} dy="0.32em" fontSize={many ? 10 : 11.5} fill="#4f5761"
                    textAnchor={flip ? 'end' : 'start'}
                    transform={`rotate(${flip ? deg + 180 : deg} ${n.x} ${n.y}) translate(${flip ? -(n.r + 6) : n.r + 6},0)`}>
                    {n.person.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        <g transform={`translate(${layout.cx},${layout.cy})`}>
          <circle r={15} fill="#fff" stroke="#1d2126" strokeWidth={2} />
          <circle r={9} fill="#1d2126" />
          <text y={-24} textAnchor="middle" fontSize={14} fontWeight={600} fill="#1d2126"
            stroke="#fff" strokeWidth={5} paintOrder="stroke">{net.focus.label}</text>
          <text y={30} textAnchor="middle" fontSize={9.5} letterSpacing="0.1em" fill="#7a838e"
            stroke="#fff" strokeWidth={4} paintOrder="stroke">{t('network.focus').toUpperCase()}</text>
        </g>
      </svg>
      {many && <p className="text-xs text-gray-500">{t('network.labelsHint', { count: net.persons.length })}</p>}
    </div>
  );
};

export default RelationsGraph;
