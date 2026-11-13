// src/prosopography/components/relations/RelationsGraph.tsx
/**
 * Ego-võrgustik lähikonnaga (#812, varem #461): fookus keskel, lähikond (sugulased ja
 * vähemalt kahe ühise teosega isikud) nimedega ovaalil — mida rohkem ühiseid teoseid,
 * seda lähemal. Kõik teised on serval täppidena ajajärjestuses (päripäeva, algus üleval).
 * Hõljutus tõstab esile isiku ja tema kaasosalised (ühine teos + osa, #464); klõps
 * kinnitab kaardi ja valik elab AINULT kaardi olekus (`popover.state.pinned`).
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VisibleNetwork } from '../../utils/network';
import { familyRelation, personKinds, STRONG } from '../../utils/network';
import { closeCircleLayout, coParticipants, GRAPH_SIZE, RIM_LABEL_MAX, spreadY } from '../../utils/closeCircle';
import { KIND_COLOR, KindMark } from './kindStyle';
import type { usePopover } from './RelationPopover';

interface Props {
  net: VisibleNetwork;
  popover: ReturnType<typeof usePopover>;
  highlight: string | null;
  onHighlight: (id: string | null) => void;
}

const FAMILY_WIDTH = 2.5;
const NAME_MAX = 24;
const CLOSE_LABEL_GAP = 28;
const RIM_LABEL_GAP = 12;
// Serva ovaal (sama mis closeCircle.ts) aastamärkide jaoks
const RIM_RX = 405;
const RIM_RY = 266;
const DIM_GROUP = 0.15;
const DIM_LINE = 0.1;

type Anchor = 'start' | 'middle' | 'end';
const anchorOf = (cos: number, inward: boolean): Anchor =>
  cos > 0.25 ? (inward ? 'end' : 'start') : cos < -0.25 ? (inward ? 'start' : 'end') : 'middle';
const shorten = (s: string) => (s.length > NAME_MAX ? `${s.slice(0, NAME_MAX)}…` : s);

/** Lükkab sildid y-teljel lahku eraldi vasakul ja paremal poolel; keskankruga jäävad paika. */
function spreadSides<T extends { y: number; anchor: Anchor; left: boolean }>(items: T[], gap: number): T[] {
  const out = [...items];
  for (const side of [true, false]) {
    const idx = out.map((it, i) => (it.anchor !== 'middle' && it.left === side ? i : -1)).filter(i => i >= 0);
    const ys = spreadY(idx.map(i => out[i].y), gap);
    idx.forEach((i, k) => { out[i] = { ...out[i], y: ys[k] }; });
  }
  return out;
}

const RelationsGraph: React.FC<Props> = ({ net, popover, highlight, onHighlight }) => {
  const { t, i18n } = useTranslation(['prosopography']);
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const layout = useMemo(() => closeCircleLayout(net), [net]);
  const co = useMemo(() => coParticipants(net), [net]);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Valiku ainus tõeallikas on kinnitatud kaart; filtrist kadunud isik ei ole valik
  const pinnedId = popover.state?.pinned ? popover.state.personId : null;
  const selected = pinnedId && net.persons.some(p => p.id === pinnedId) ? pinnedId : null;
  const active = selected ?? highlight;
  const lit = (id: string) => active === null || id === active || !!co.get(active)?.has(id);

  const { cx, cy, maxWorks } = layout;

  // Lähikonna sildid: nimi + teine rida (suguluse liik · ühised teosed)
  const closeLabels = useMemo(() => {
    const labelOf = (id: string) => (id === net.focus.id ? net.focus.label : net.persons.find(x => x.id === id)?.label ?? id);
    return spreadSides(layout.close.map(n => {
    const cos = Math.cos(n.angle);
    const sin = Math.sin(n.angle);
    const anchor = anchorOf(cos, false);
    const fam = n.person.edges.find(e => e.kind === 'family');
    // Kirje tüüp kirjeldab SIHTISIKUT. Kui siht on fookus („Fischer on tema isa"), ei saa
    // tüüpi selle isiku juurde panna ega pöörata (sõltub soost) → üldine liigi nimi.
    const rel = fam ? familyRelation(fam, net.focus.id, labelOf, lang) : null;
    const famType = rel
      ? (rel.subjectId === n.person.id ? rel.type : t('network.kinds.family'))
      : fam ? t('network.kinds.family') : undefined;
    const sub = [famType, n.person.workCount > 0 ? t('network.sharedWorks', { count: n.person.workCount }) : null]
      .filter(Boolean).join(' · ');
    const x = anchor === 'start' ? n.x + n.r + 6 : anchor === 'end' ? n.x - n.r - 6 : n.x;
    // Keskankur: üleval nimi märgi kohal, all märgi all
    const y = anchor !== 'middle' ? n.y - 2 : sin < 0 ? n.y - n.r - (sub ? 18 : 6) : n.y + n.r + 13;
    return { id: n.person.id, x, y, anchor, left: cos < 0, name: shorten(n.person.label), sub };
    }), CLOSE_LABEL_GAP);
  }, [layout, net, lang, t]);
  const closeLabelById = new Map(closeLabels.map(l => [l.id, l]));

  // Servanimed valiku ajal: kaasosalised kahanevalt ühiste võtmete järgi, lisaks hõljutatud täpp
  const rimLabels = useMemo(() => {
    if (!selected) return [];
    const weights = co.get(selected)!;
    const chosen = layout.rim
      .filter(n => weights.has(n.person.id) || n.person.id === selected)
      .sort((a, b) => (b.person.id === selected ? 1 : 0) - (a.person.id === selected ? 1 : 0)
        || (weights.get(b.person.id) ?? 0) - (weights.get(a.person.id) ?? 0))
      .slice(0, RIM_LABEL_MAX);
    const hovered = hoverId ? layout.rim.find(n => n.person.id === hoverId) : undefined;
    if (hovered && !chosen.includes(hovered)) chosen.push(hovered);
    return spreadSides(chosen.map(n => {
      const cos = Math.cos(n.angle);
      const sin = Math.sin(n.angle);
      return { id: n.person.id, x: n.x - cos * 9, y: n.y - sin * 9 + 3, anchor: anchorOf(cos, true), left: cos < 0,
               name: shorten(n.person.label) };
    }), RIM_LABEL_GAP);
  }, [selected, hoverId, layout, co]);

  // Kaared ainult esiletõstu/valiku ajal: kaasosalistest lähikonna paarid
  const arcs = useMemo(() => {
    if (active === null) return [];
    const ring = co.get(active);
    const litClose = layout.close.filter(n => n.person.id === active || !!ring?.has(n.person.id));
    const out: Array<{ a: typeof litClose[number]; b: typeof litClose[number] }> = [];
    for (let i = 0; i < litClose.length; i++) {
      for (let j = i + 1; j < litClose.length; j++) {
        if (co.get(litClose[i].person.id)?.has(litClose[j].person.id)) out.push({ a: litClose[i], b: litClose[j] });
      }
    }
    return out;
  }, [active, layout, co]);

  const selectedNode = selected
    ? layout.close.find(n => n.person.id === selected) ?? layout.rim.find(n => n.person.id === selected)
    : undefined;

  const handlers = (id: string) => ({
    onMouseEnter: (e: React.MouseEvent) => {
      if (!selected) onHighlight(id);
      popover.hover(id, e);
      if (selected) setHoverId(id);
    },
    onMouseMove: (e: React.MouseEvent) => popover.hover(id, e),
    onMouseLeave: () => {
      // Alati: klõpsule eelnenud hõljutus jättis esiletõstu, mis muidu jääks pärast
      // kaardi sulgemist kinni (valiku ajal varjab seda niikuinii `selected`)
      onHighlight(null);
      popover.leave();
      setHoverId(null);
    },
    onClick: (e: React.MouseEvent) => popover.pin(id, e),
  });

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${GRAPH_SIZE.w} ${GRAPH_SIZE.h}`} className="h-auto w-full" role="img"
        aria-label={`${net.focus.label}: ${t('network.persons', { count: net.persons.length })}`}>
        {/* Aastamärgid serva taga */}
        <g>
          {layout.ticks.map((tk, i) => {
            const cos = Math.cos(tk.angle);
            const sin = Math.sin(tk.angle);
            const ex = cx + RIM_RX * cos;
            const ey = cy + RIM_RY * sin;
            return (
              <g key={i}>
                <line x1={ex - 7 * cos} y1={ey - 7 * sin} x2={ex + 9 * cos} y2={ey + 9 * sin} stroke="#b4bbc3" strokeWidth={1} />
                <text x={cx + 422 * cos} y={cy + 282 * sin} dy="0.32em" fontSize={9} fill="#7a838e"
                  textAnchor={anchorOf(cos, false)}>
                  {tk.year ?? t('network.undated')}
                </text>
              </g>
            );
          })}
        </g>
        <g fill="none">
          {arcs.map(({ a, b }) => {
            const mx = cx + (a.x + b.x - 2 * cx) * 0.25;
            const my = cy + (a.y + b.y - 2 * cy) * 0.25;
            return <path key={`${a.person.id}|${b.person.id}`} data-testid="co-arc"
              d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`} stroke="#9aa3ad" strokeOpacity={0.6} strokeWidth={1} />;
          })}
        </g>
        <g>
          {layout.close.flatMap(n => {
            // Mitu tugevat liiki (nt sugulane + respondens) → paralleeljooned risti raadiusega.
            // Pereserval teost ei ole — jämedus on püsiv, muidu sõltuks see kõrvalseose teostest.
            const kinds = personKinds(n.person);
            const width = (kind: string) => (kind === 'family' ? FAMILY_WIDTH : 1.5 + (n.person.workCount / Math.max(1, maxWorks)) * 5);
            const gap = Math.max(...kinds.map(width)) + 1.5;
            const nx = -Math.sin(n.angle); const ny = Math.cos(n.angle);
            const on = lit(n.person.id);
            return kinds.map((kind, i) => {
              const off = (i - (kinds.length - 1) / 2) * gap;
              return (
                <line key={`${n.person.id}|${kind}`} x1={cx + nx * off} y1={cy + ny * off}
                  x2={n.x + nx * off} y2={n.y + ny * off}
                  stroke={KIND_COLOR[kind]} strokeOpacity={on ? (STRONG.has(kind) ? 0.55 : 0.3) : DIM_LINE}
                  strokeWidth={width(kind)}
                  strokeDasharray={kind === 'family' ? '4 3' : kind === 'mention' ? '2 3' : undefined} />
              );
            });
          })}
        </g>
        <g>
          {layout.rim.map(n => {
            const on = lit(n.person.id);
            return (
              <g key={n.person.id} data-testid={`node-${n.person.id}`} data-ring="rim" data-lit={String(on)}
                style={{ cursor: 'pointer', opacity: on ? 1 : DIM_GROUP }} {...handlers(n.person.id)}>
                <circle cx={n.x} cy={n.y} r={9} fill="transparent" />
                <g opacity={active !== null && on ? 0.95 : n.opacity}>
                  <KindMark kind={n.person.kind} r={n.r} x={n.x} y={n.y} />
                </g>
              </g>
            );
          })}
        </g>
        <g>
          {layout.close.map(n => {
            const on = lit(n.person.id);
            const l = closeLabelById.get(n.person.id)!;
            return (
              <g key={n.person.id} data-testid={`node-${n.person.id}`} data-ring="close" data-lit={String(on)}
                style={{ cursor: 'pointer', opacity: on ? 1 : DIM_GROUP }} {...handlers(n.person.id)}>
                <circle cx={n.x} cy={n.y} r={Math.max(12, n.r + 4)} fill="transparent" />
                <KindMark kind={n.person.kind} r={n.r} x={n.x} y={n.y} />
                <g stroke="#fff" strokeWidth={4} paintOrder="stroke" textAnchor={l.anchor}>
                  <text x={l.x} y={l.y} fontSize={11.5} fontWeight={600} fill="#1d2126">{l.name}</text>
                  {l.sub && <text x={l.x} y={l.y + 12} fontSize={9.5} fill="#6b737d">{l.sub}</text>}
                </g>
              </g>
            );
          })}
        </g>
        {selectedNode && (
          <circle data-testid="selected-ring" cx={selectedNode.x} cy={selectedNode.y} r={selectedNode.r + 5}
            fill="none" stroke="#1d2126" strokeWidth={1.5} pointerEvents="none" />
        )}
        <g pointerEvents="none">
          {rimLabels.map(l => (
            <text key={l.id} data-testid={`rim-label-${l.id}`} x={l.x} y={l.y} fontSize={10} fill="#1d2126"
              textAnchor={l.anchor} stroke="#fff" strokeWidth={3} paintOrder="stroke">{l.name}</text>
          ))}
        </g>
        <g transform={`translate(${cx},${cy})`} pointerEvents="none">
          <circle r={15} fill="#fff" stroke="#1d2126" strokeWidth={2} />
          <circle r={9} fill="#1d2126" />
          <text y={-24} textAnchor="middle" fontSize={14} fontWeight={600} fill="#1d2126"
            stroke="#fff" strokeWidth={5} paintOrder="stroke">{net.focus.label}</text>
          <text y={30} textAnchor="middle" fontSize={9.5} letterSpacing="0.1em" fill="#7a838e"
            stroke="#fff" strokeWidth={4} paintOrder="stroke">{t('network.focus').toUpperCase()}</text>
        </g>
      </svg>
      <p className="text-xs text-gray-500">
        {layout.close.length === 0 ? t('network.noCloseCircle') : t('network.closeHint')}
      </p>
    </div>
  );
};

export default RelationsGraph;
