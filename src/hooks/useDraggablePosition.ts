/**
 * Päisest lohistatav hõljuv paneel (MetadataModal, teose osade paneel #464).
 * Asukoht piiratakse `clampPosition`-iga, et päise haarderiba jääks alati kätte.
 * `storageKey` korral jääb asukoht seansi ajaks meelde (sessionStorage; tõrge =
 * vaikimisi asukoht, mitte viga).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { clampPosition, type Point } from '../utils/dragPosition';

type Anchor = 'center' | 'right';

function readStored(key: string | undefined): Point | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p.x === 'number' && typeof p.y === 'number' ? p : null;
  } catch {
    return null;
  }
}

function writeStored(key: string | undefined, p: Point) {
  if (!key) return;
  try { sessionStorage.setItem(key, JSON.stringify(p)); } catch { /* mugavus, mitte kohustus */ }
}

export function useDraggablePosition<E extends HTMLElement = HTMLDivElement>(
  { anchor = 'center', storageKey }: { anchor?: Anchor; storageKey?: string } = {},
) {
  const ref = useRef<E>(null);
  const [pos, setPos] = useState<Point | null>(() => readStored(storageKey));
  const cleanup = useRef<(() => void) | null>(null);

  // Mahaharakendamisel poolik lohistus lahti, muidu jääksid aknakuularid rippuma.
  useEffect(() => () => cleanup.current?.(), []);

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const size = { w: rect.width, h: rect.height };
    let last: Point = { x: rect.left, y: rect.top };
    const onMove = (ev: MouseEvent) => {
      last = clampPosition({ x: ev.clientX - offset.x, y: ev.clientY - offset.y }, size,
        { w: window.innerWidth, h: window.innerHeight });
      setPos(last);
    };
    const onUp = () => {
      cleanup.current?.();
      writeStored(storageKey, last);
    };
    cleanup.current = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cleanup.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [storageKey]);

  const reset = useCallback(() => setPos(null), []);

  const style: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, transform: 'none', margin: 0 }
    : anchor === 'center'
      ? { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', margin: 0 }
      : { position: 'fixed', right: 24, top: 80, margin: 0 };

  return { ref, style, onHandleMouseDown, reset, pos };
}
