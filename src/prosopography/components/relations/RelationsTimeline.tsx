// src/prosopography/components/relations/RelationsTimeline.tsx
/**
 * Ajatelg (#461, „Millal ja mis rollis"): rida isiku kohta, märk aasta kohal.
 * Sama aasta teosed = üks liitmärk arvuga; aastata servad „Aeg teadmata" veerus.
 * Pikk loend keritakse oma konteineris (spekk lubab erandi „kerib aken" reeglist).
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { VisibleNetwork } from '../../utils/network';
import { timelineRows } from '../../utils/network';
import { KindMark } from './kindStyle';
import type { usePopover } from './RelationPopover';

interface Props {
  net: VisibleNetwork;
  popover: ReturnType<typeof usePopover>;
  highlight: string | null;
  onHighlight: (id: string | null) => void;
}

const W = 900;
const LEFT = 190;
const UNDATED_W = 90;
const ROW = 18;

const RelationsTimeline: React.FC<Props> = ({ net, popover, highlight, onHighlight }) => {
  const { t } = useTranslation(['prosopography']);
  const { rows, minYear, maxYear, hasUndated } = useMemo(() => timelineRows(net), [net]);
  const right = W - 16 - (hasUndated ? UNDATED_W : 0);
  const y0 = (minYear ?? 0) - 1;
  const y1 = (maxYear ?? 0) + 1;
  const x = (y: number) => LEFT + ((y - y0) / Math.max(1, y1 - y0)) * (right - LEFT);
  const step = Math.max(1, Math.ceil((y1 - y0) / 10));
  const ticks = minYear === null ? [] : Array.from({ length: Math.floor((y1 - y0) / step) + 1 }, (_, i) => y0 + i * step);
  const undatedX = right + UNDATED_W / 2;
  const H = rows.length * ROW + 8;

  return (
    <div>
      {/* Telg on samas keritavas konteineris (sticky): eraldi SVG väljaspool skaleerus
          kerimisriba võrra teisiti ja aastad nihkusid ruudustikust. */}
      <div data-timeline-scroller className="max-h-[540px] overflow-auto border-t border-gray-100">
        <svg data-timeline-axis viewBox={`0 0 ${W} 26`} className="sticky top-0 z-10 h-auto w-full bg-white" aria-hidden="true">
          {ticks.map(tk => <text key={tk} x={x(tk)} y={16} textAnchor="middle" fontSize={11} fill="#4f5761">{tk}</text>)}
          {hasUndated && <text x={undatedX} y={16} textAnchor="middle" fontSize={11} fill="#4f5761">{t('network.undated')}</text>}
        </svg>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t('network.tabs.timeline')}>
          {ticks.map(tk => <line key={tk} x1={x(tk)} x2={x(tk)} y1={0} y2={H} stroke="#eceef1" />)}
          {hasUndated && <line x1={right + 4} x2={right + 4} y1={0} y2={H} stroke="#dde1e5" strokeDasharray="3 3" />}
          {rows.map((row, i) => {
            const y = i * ROW + ROW / 2 + 4;
            const id = row.person.id;
            const dated = row.marks.filter(m => m.year !== null).map(m => m.year as number);
            return (
              <g key={id} style={{ cursor: 'pointer', opacity: highlight && highlight !== id ? 0.15 : 1 }}
                onMouseEnter={e => { onHighlight(id); popover.hover(id, e); }}
                onMouseMove={e => popover.hover(id, e)}
                onMouseLeave={() => { onHighlight(null); popover.leave(); }}
                onClick={e => { onHighlight(id); popover.pin(id, e); }}>
                <rect x={0} y={y - ROW / 2} width={W} height={ROW} fill="transparent" />
                <text x={LEFT - 12} y={y} dy="0.32em" textAnchor="end" fontSize={11} fill="#4f5761">
                  {row.person.label.length > 28 ? `${row.person.label.slice(0, 27)}…` : row.person.label}
                </text>
                {dated.length > 1 && (
                  <line x1={x(Math.min(...dated))} x2={x(Math.max(...dated))} y1={y} y2={y} stroke="#dde1e5" strokeWidth={2} />
                )}
                {row.marks.map(m => {
                  const mx = m.year === null ? undatedX : x(m.year);
                  return (
                    <g key={String(m.year)}
                      // Liitmärk: klikk näitab ainult selle aasta teoseid (spekk, „Ajatelg").
                      onClick={m.works.length > 1 ? e => { onHighlight(id); popover.pin(id, e, m.year); } : undefined}>
                      <KindMark kind={m.kind} r={m.works.length > 1 ? 5.5 : 4.2} x={mx} y={y} />
                      {m.works.length > 1 && (
                        <text x={mx + 8} y={y} dy="0.32em" fontSize={9.5} fill="#4f5761">{m.works.length}</text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

export default RelationsTimeline;
