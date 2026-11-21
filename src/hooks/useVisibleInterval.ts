import { useEffect, useRef } from 'react';
import { startVisibleInterval } from '../utils/visibleInterval';

/**
 * Reacti ümbris `startVisibleInterval`-ile (#854): küsitlus ainult nähtaval
 * vahekaardil, ettetoomisel kohe üks kutse.
 *
 * `fn` loetakse ref'ist — uus sulund igal renderdusel ei taaskäivita taimerit.
 * Taimer taaskäivitub (koos koheste kutsega, kui `immediate`) ainult siis, kui
 * muutub `enabled`, `intervalMs` või `restartKey`.
 */
export function useVisibleInterval(
  fn: () => void,
  intervalMs: number,
  { enabled = true, immediate = true, restartKey }: {
    enabled?: boolean;
    immediate?: boolean;
    restartKey?: unknown;
  } = {},
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    return startVisibleInterval(() => fnRef.current(), intervalMs, { immediate });
  }, [enabled, intervalMs, immediate, restartKey]);
}
