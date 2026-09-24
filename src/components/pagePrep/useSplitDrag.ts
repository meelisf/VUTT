import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Poolitusjoone lohistus. `frameRef` on element, mille kast võrdub PILDI
 * kastiga — x arvutatakse selle laiuse osana (0..1), mitte konteineri järgi
 * (letterbox'i tühi ala ei tohi joont nihutada).
 *
 * Lohistust kuulatakse AKNAST, et kursor võiks väljuda pildi raamist.
 * Kast mõõdetakse sündmuse hetkel: kerimine/akna muutus võib varem mõõdetu
 * vananenuks teha ja vale x jõuaks olekusse.
 */
export function useSplitDrag(
  frameRef: React.RefObject<HTMLElement | null>,
  onX: (x: number) => void,
) {
  const [dragging, setDragging] = useState(false);

  // Ref hoiab värskeimat kutsujat, et aknakuulajaid ei tellitaks iga renderi
  // peale uuesti (kutsuja annab sageli inline-arrow'i).
  const onXRef = useRef(onX);
  onXRef.current = onX;

  const updateFromClientX = useCallback((clientX: number) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    onXRef.current((clientX - rect.left) / rect.width);
  }, [frameRef]);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => updateFromClientX(e.clientX);
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, updateFromClientX]);

  const startDrag = useCallback(() => setDragging(true), []);

  return { dragging, startDrag, updateFromClientX };
}
