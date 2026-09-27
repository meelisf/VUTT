// src/prosopography/components/relations/RelationPopover.tsx
/**
 * Ühine hüpikaken seoste vaadetele (#461): hõljutus näitab lühivaadet, klikk kinnitab
 * (lingid isiku- ja teoselehele). Sulgub nupuga, klikiga mujale või Esc-iga.
 * z-[1300]: päis on z-[1200] (CLAUDE.md).
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { VisibleNetwork } from '../../utils/network';
import { familyLabel } from '../../utils/network';

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
  const { t } = useTranslation(['prosopography', 'workspace']);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!state || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = state.x + 14;
    let top = state.y + 14;
    if (left + r.width > window.innerWidth - 8) left = state.x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = state.y - r.height - 14;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [state]);

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
  const years = p.birth_year || p.death_year ? `${p.birth_year ?? '?'}–${p.death_year ?? '?'}` : '';

  return (
    <div
      ref={ref}
      data-relation-popover
      role={state.pinned ? 'dialog' : 'tooltip'}
      className={`fixed z-[1300] max-w-sm rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg ${state.pinned ? 'max-h-[70vh] overflow-auto' : 'pointer-events-none'}`}
      style={pos}
    >
      <div className="text-sm font-semibold text-gray-900">{p.label}</div>
      <div className="text-gray-500">
        {years}{years ? ' · ' : ''}
        {p.origin?.place ? t('network.origin', { place: p.origin.place }) : t('network.originUnknown')}
      </div>
      <div className="text-gray-500">
        {t(`network.kinds.${p.kind}`)} · {t('network.sharedWorks', { count: p.workCount })}
      </div>
      {fam && familyLabel(fam, net.focus.id, labelOf) && (
        <div className="mt-1 text-gray-700">{familyLabel(fam, net.focus.id, labelOf)}</div>
      )}
      {shown.length > 0 && (
        <ul className="mt-2 space-y-1.5 pl-3 list-disc">
          {shown.map((e, i) => {
            const w = net.works.get(e.evidence!.work_id);
            const page = e.evidence!.pages[0] ?? 1;
            const title = w?.title ? (w.title.length > 90 ? `${w.title.slice(0, 89)}…` : w.title) : e.evidence!.work_id;
            return (
              <li key={`${e.evidence!.work_id}-${i}`}>
                <span className="text-gray-500">
                  {w?.year ?? '?'} · {w?.place?.label ?? t('network.unknownPlace')} · {t(`network.kinds.${e.kind}`)}
                </span>
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
      {state.pinned ? (
        <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
          <Link to={`/persons/${p.id}`} className="text-primary-700 hover:underline">{t('network.openPerson')} ↗</Link>
          <button type="button" onClick={onClose} className="flex items-center gap-1 text-gray-500 hover:text-gray-800">
            <X size={12} /> {t('network.close')}
          </button>
        </div>
      ) : (
        <div className="mt-2 text-gray-400">{t('network.pinHint')}</div>
      )}
    </div>
  );
};

export default RelationPopover;
