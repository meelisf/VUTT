// src/prosopography/components/relations/RelationPopover.tsx
/**
 * Ühine hüpikaken seoste vaadetele (#461): hõljutus näitab lühivaadet, klikk kinnitab
 * (lingid isiku- ja teoselehele). Sulgub nupuga, klikiga mujale või Esc-iga.
 * Kinnitatud kaarti saab nimereast lohistada (#812); nihet ei mäletata — uus avamine
 * tuleb jälle kursori kõrvale. Kaart jääb vaateakna sisse 8 px varuga.
 * z-[1300]: päis on z-[1200] (CLAUDE.md).
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { VisibleNetwork } from '../../utils/network';
import type { NetworkEdge, NetworkWork } from '../../services/networkService';
import { evidenceTarget, familyRelation } from '../../utils/network';
import { formatRelationOwnerName } from '../../utils/estonianName';
import { distinguishingText } from '../../utils/distinguishing';

/** Rea koht. Osa real osa enda koht (saatmis- või toimumiskoht), trükikoht ei ole kirja
 *  koht (#464). Teose real trükikoht; „teadmata" ainult trükisel — käsikirjal trükikohta pole. */
function placeLabel(e: NetworkEdge, w: NetworkWork | undefined, isPart: boolean, unknown: string): string | null {
  if (isPart) return e.place && e.place.kind !== 'print' ? e.place.label || null : null;
  return w?.place?.label || (w?.manuscript ? null : unknown);
}

/** `year` (valikuline): ajatelje liitmärk — näita ainult selle aasta teoseid. */
export interface PopoverState { personId: string; x: number; y: number; pinned: boolean; year?: number | null; }

export function usePopover() {
  const [state, setState] = useState<PopoverState | null>(null);
  const pinnedRef = useRef(false);
  const hover = useCallback((personId: string, ev: React.MouseEvent) => {
    if (pinnedRef.current) return;
    // Sama isik: olekut ei vahetata — muidu renderdaks iga hiireliigutus kogu võrgustiku
    // (241 sõlme + kaaslaste kaared) uuesti. Vihje jääb sisenemiskohta.
    setState(prev => (prev && !prev.pinned && prev.personId === personId
      ? prev
      : { personId, x: ev.clientX, y: ev.clientY, pinned: false }));
  }, []);
  const leave = useCallback(() => { if (!pinnedRef.current) setState(null); }, []);
  const pin = useCallback((personId: string, ev: React.MouseEvent, year?: number | null) => {
    ev.stopPropagation();
    pinnedRef.current = true;
    setState({ personId, x: ev.clientX, y: ev.clientY, pinned: true, ...(year !== undefined ? { year } : {}) });
  }, []);
  const close = useCallback(() => { pinnedRef.current = false; setState(null); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onClick = (e: MouseEvent) => {
      if (pinnedRef.current && !(e.target as Element | null)?.closest?.('[data-relation-popover]')) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick); };
  }, [close]);
  return { state, hover, leave, pin, close };
}

const surname = (n: string) => n.trim().split(/\s+/).pop() ?? n;
const MAX_HOVER_WORKS = 4;

const RelationPopover: React.FC<{ state: PopoverState | null; net: VisibleNetwork; onClose: () => void }> = ({ state, net, onClose }) => {
  const { t, i18n } = useTranslation(['prosopography', 'workspace']);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  // Lohistamise nihe praegusest kohast; lähtestub iga uue oleku (kinnitus/hõljutus) peale
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const posRef = useRef(pos);
  const stopDragRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    stopDragRef.current?.();
    setDrag({ dx: 0, dy: 0 });
    if (!state || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = state.x + 14;
    let top = state.y + 14;
    if (left + r.width > window.innerWidth - 8) left = state.x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = state.y - r.height - 14;
    const next = { left: Math.max(8, left), top: Math.max(8, top) };
    posRef.current = next;
    setPos(next);
  }, [state]);

  useEffect(() => () => stopDragRef.current?.(), []);

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();   // teksti valik ei alga
    stopDragRef.current?.();
    const start = { x: e.clientX, y: e.clientY, dx: drag.dx, dy: drag.dy };
    // Kui kaart on vaateaknast suurem, võidab alumine piir (8)
    const clamp = (v: number, max: number) => Math.max(8, Math.min(v, max));
    const onMove = (ev: PointerEvent) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const base = posRef.current;
      const left = clamp(base.left + start.dx + ev.clientX - start.x, window.innerWidth - r.width - 8);
      const top = clamp(base.top + start.dy + ev.clientY - start.y, window.innerHeight - r.height - 8);
      setDrag({ dx: left - base.left, dy: top - base.top });
    };
    const stop = (ev?: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      stopDragRef.current = null;
      // Piiril kinni jäänud lohistuse lõpp võib olla kaardist väljas → brauseri click läheks
      // „klõps mujale sulgeb" kuularini. Neelame selle ühe click-i (capture enne document'i).
      if (ev && (ev.clientX !== start.x || ev.clientY !== start.y)) {
        const swallow = (c: MouseEvent) => { c.stopPropagation(); release(); };
        const release = () => window.removeEventListener('click', swallow, true);
        window.addEventListener('click', swallow, true);
        setTimeout(release, 0);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    stopDragRef.current = stop;
  };

  if (!state) return null;
  const p = net.persons.find(x => x.id === state.personId);
  if (!p) return null;
  const labelOf = (id: string) => (id === net.focus.id ? net.focus.label : net.persons.find(x => x.id === id)?.label ?? id);
  const roles = (rs?: string[]) => (rs ?? []).map(r => t(`workspace:metadata.roles.${r}`, { defaultValue: r })).join(', ');
  const yearOnly = state.year !== undefined;
  const workEdges = p.edges
    .filter(e => e.evidence && (!yearOnly || (e.year ?? null) === state.year))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
  const shown = state.pinned ? workEdges : workEdges.slice(0, MAX_HOVER_WORKS);
  const fam = p.edges.find(e => e.kind === 'family');
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const famRel = fam ? familyRelation(fam, net.focus.id, labelOf, lang) : null;
  // Täislause („X on Y-i isa"): lühikuju „Y: isa" loeti valesti suunas
  const famLabel = famRel
    ? t('form.relationSentence', { other: famRel.subject, self: formatRelationOwnerName(famRel.owner, lang), type: famRel.type })
    : null;
  const years = distinguishingText(p);

  return (
    <div
      ref={ref}
      data-relation-popover
      role={state.pinned ? 'dialog' : 'tooltip'}
      className={`fixed z-[1300] max-w-sm rounded-lg border border-gray-200 bg-white text-xs shadow-lg ${state.pinned ? 'flex max-h-[70vh] flex-col' : 'pointer-events-none'}`}
      style={{ left: pos.left + drag.dx, top: pos.top + drag.dy }}
    >
      {/* Kinnitatud aknas kerib ainult sisu; tegevusjalus (ava/sulge) jääb alati nähtavale */}
      <div className={`p-3 ${state.pinned ? 'min-h-0 flex-1 overflow-auto' : ''}`}>
        {state.pinned ? (
          <div data-testid="popover-drag" title={t('network.dragHint')} onPointerDown={startDrag}
            className="cursor-move select-none text-sm font-semibold text-gray-900" style={{ touchAction: 'none' }}>
            {p.label}
          </div>
        ) : (
          <div className="text-sm font-semibold text-gray-900">{p.label}</div>
        )}
        <div className="text-gray-500">
          {years}{years ? ' · ' : ''}
          {p.origin?.place ? t('network.origin', { place: p.origin.place }) : t('network.originUnknown')}
        </div>
        <div className="text-gray-500">
          {t(`network.kinds.${p.kind}`)} · {t('network.sharedWorks', { count: p.workCount })}
        </div>
        {famLabel && <div className="mt-1 text-gray-700">{famLabel}</div>}
        {shown.length > 0 && (
          <ul className="mt-2 space-y-1.5 pl-3 list-disc">
            {shown.map((e, i) => {
              const w = net.works.get(e.evidence!.work_id);
              const { page, part } = evidenceTarget(e, net);
              const title = w?.title ? (w.title.length > 90 ? `${w.title.slice(0, 89)}…` : w.title) : e.evidence!.work_id;
              const place = placeLabel(e, w, !!part, t('network.unknownPlace'));
              return (
                <li key={`${e.evidence!.work_id}-${i}`}>
                  <span className="text-gray-500">
                    {e.year ?? w?.year ?? '?'}
                    {place && <> · {place}</>}
                    {' · '}{t(`network.kinds.${e.kind}`)}
                  </span>
                  {part && (
                    <div className="text-gray-700">
                      {t(`workspace:manage.parts.kinds.${part.kind}`)}{part.title ? `: ${part.title}` : ''}
                    </div>
                  )}
                  <div className="text-gray-700">
                    <b>{surname(p.label)}:</b> {roles(e.roles?.[p.id])} · <b>{surname(net.focus.label)}:</b> {roles(e.roles?.[net.focus.id])}
                  </div>
                  <div>
                    {state.pinned && w && !w.restricted
                      ? <Link to={`/work/${w.work_id}/${page}`} className="text-primary-700 hover:underline">{title}</Link>
                      : <span className="text-gray-500">{title}</span>}
                    {w?.restricted && <span className="ml-1 text-gray-400">({t('network.restricted')})</span>}
                    {e.evidence!.pages.length > 0 && (
                      <span className="ml-1 text-gray-400">({t('network.pages', { pages: e.evidence!.pages.join(', ') })})</span>
                    )}
                  </div>
                </li>
              );
            })}
            {!state.pinned && workEdges.length > MAX_HOVER_WORKS && (
              <li className="list-none text-gray-400">{t('network.moreWorks', { count: workEdges.length - MAX_HOVER_WORKS })}</li>
            )}
          </ul>
        )}
        {!state.pinned && <div className="mt-2 text-gray-400">{t('network.pinHint')}</div>}
      </div>
      {state.pinned && (
        <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-3 py-2">
          <Link to={`/persons/${p.id}`} className="text-primary-700 hover:underline">{t('network.openPerson')} ↗</Link>
          <button type="button" onClick={onClose} className="flex items-center gap-1 text-gray-500 hover:text-gray-800">
            <X size={12} /> {t('network.close')}
          </button>
        </div>
      )}
    </div>
  );
};

export default RelationPopover;
