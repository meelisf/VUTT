// Lehe tähistuse paneel (ADR 0070, spekk §3): alati nähtav, lohistatav, suletav.
// Katse 2026-10-16: rippmenüüs „peab valikut jahtima", paneel on mugavam.
// Lahti/kinni ja asukoht on brauseri mugavusseaded (localStorage, try/catch).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { PAGE_MARK_KINDS, type PageMarkKind } from '../../markup/vuttTags';
import type { PageMarkRefusal } from './pageMarkEdit';

const OPEN_KEY = 'vutt_pagemark_palette';
const POS_KEY = 'vutt_pagemark_palette_pos';
const KEY_OF: Record<PageMarkKind, string> = { fw: 'f', sig: 's', catch: 'c', rh: 'r' };

export function readPaletteOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
}
export function writePaletteOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* mugavusseade */ }
}
function readPos(): { x: number; y: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null;
  } catch { return null; }
}

function useRefusal() {
  const { t } = useTranslation(['workspace']);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = useCallback((r: PageMarkRefusal | null) => {
    if (!r) return;
    setMsg(t(`editor.pageMarks.refused.${r}`));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3000);
  }, [t]);
  return { msg, show };
}

interface PaletteProps {
  open: boolean;
  onClose: () => void;
  onApply: (k: PageMarkKind) => PageMarkRefusal | null;
  containerRef: RefObject<HTMLElement | null>;
}

export default function PageMarkPalette({ open, onClose, onApply, containerRef }: PaletteProps) {
  const { t } = useTranslation(['workspace']);
  const palRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(readPos);
  const { msg, show } = useRefusal();

  const clamp = useCallback((x: number, y: number) => {
    const box = containerRef.current;
    const pal = palRef.current;
    const maxX = Math.max(0, (box?.clientWidth ?? 0) - (pal?.offsetWidth ?? 0));
    const maxY = Math.max(0, (box?.clientHeight ?? 0) - (pal?.offsetHeight ?? 0));
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  }, [containerRef]);

  // Salvestatud asukoht võib olla kitsama kasti jaoks liiga suur — klammerda kohe.
  useLayoutEffect(() => {
    if (pos) {
      const c = clamp(pos.x, pos.y);
      if (c.x !== pos.x || c.y !== pos.y) setPos(c);
    }
  }, [pos, clamp, open]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const pal = palRef.current;
    if (!pal) return;
    const start = { px: e.clientX, py: e.clientY, x: pal.offsetLeft, y: pal.offsetTop };
    const move = (ev: PointerEvent) => setPos(clamp(start.x + ev.clientX - start.px, start.y + ev.clientY - start.py));
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: pal.offsetLeft, y: pal.offsetTop })); } catch { /* mugavusseade */ }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  if (!open) return null;
  const style = pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { right: '14px', top: '6px' };
  return (
    <div ref={palRef} data-testid="pagemark-palette" style={style}
      className="absolute z-10 flex items-center gap-1 rounded-md border border-gray-300 bg-white/95 px-1.5 py-1 text-xs shadow-sm">
      <span onPointerDown={startDrag} title={t('editor.pageMarks.drag')}
        className="cursor-grab select-none pr-1 text-[11px] text-gray-400">⠿ {t('editor.pageMarks.title')}</span>
      {PAGE_MARK_KINDS.map(k => (
        <button key={k} type="button" onMouseDown={e => { e.preventDefault(); show(onApply(k)); }}
          className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-700 hover:border-indigo-200 hover:bg-indigo-50">
          {t(`editor.pageMarks.${k}`)}<span className="ml-1 font-mono text-[10px] text-gray-400">{KEY_OF[k]}</span>
        </button>
      ))}
      <button type="button" onMouseDown={e => { e.preventDefault(); onClose(); }} title={t('editor.pageMarks.close')}
        className="px-1 text-gray-400 hover:text-gray-700"><X size={13} /></button>
      {msg && <span role="status" className="absolute left-0 top-full mt-1 whitespace-nowrap rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 shadow-sm">{msg}</span>}
    </div>
  );
}

interface MenuProps {
  anchor: { left: number; top: number };
  onApply: (k: PageMarkKind) => PageMarkRefusal | null;
  onClose: () => void;
}

// Ctrl/⌘+Shift+F menüü kursori juures: täht (f s c r) või nooled + Enter, Esc sulgeb.
export function PageMarkMenu({ anchor, onApply, onClose }: MenuProps) {
  const { t } = useTranslation(['workspace']);
  const [active, setActive] = useState(0);
  const { msg, show } = useRefusal();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Pelgalt muuteklahv (Shift jne) ei tee midagi. Muuteklahviga kombinatsioon
      // (Ctrl+S, Ctrl+C) ja muu klahv sulgevad menüü ning jõuavad edasi — menüü ei
      // tohi neelata salvestust ega trükkimist.
      if (['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) { onClose(); return; }
      const byKey = PAGE_MARK_KINDS.find(k => KEY_OF[k] === e.key.toLowerCase());
      let handled = true;
      if (byKey) { const r = onApply(byKey); show(r); if (!r) onClose(); }
      else if (e.key === 'ArrowDown') setActive(a => (a + 1) % PAGE_MARK_KINDS.length);
      else if (e.key === 'ArrowUp') setActive(a => (a + PAGE_MARK_KINDS.length - 1) % PAGE_MARK_KINDS.length);
      else if (e.key === 'Enter') { const r = onApply(PAGE_MARK_KINDS[active]); show(r); if (!r) onClose(); }
      else if (e.key === 'Escape') onClose();
      else { handled = false; onClose(); }
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    };
    // Klõps menüüst väljas sulgeb (nt tagasi teksti või kommentaari kasti).
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [active, onApply, onClose, show]);
  return (
    <div ref={menuRef} role="menu" style={{ left: anchor.left, top: anchor.top }}
      className="fixed z-[1250] min-w-[220px] rounded-md border border-gray-300 bg-white p-1 text-xs shadow-lg">
      <div className="px-2 pb-1 pt-0.5 text-[11px] text-gray-400">{t('editor.pageMarks.title')}</div>
      {PAGE_MARK_KINDS.map((k, i) => (
        <div key={k} role="menuitem" onMouseDown={e => { e.preventDefault(); const r = onApply(k); show(r); if (!r) onClose(); }}
          className={`flex cursor-pointer justify-between gap-4 rounded px-2 py-1 ${i === active ? 'bg-indigo-50' : 'hover:bg-indigo-50'}`}>
          <span>{t(`editor.pageMarks.${k}`)}</span><span className="font-mono text-gray-400">{KEY_OF[k]}</span>
        </div>
      ))}
      {msg && <div role="status" className="px-2 py-1 text-[11px] text-amber-800">{msg}</div>}
    </div>
  );
}
