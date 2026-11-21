/**
 * Intervall, mis jookseb ainult nähtaval vahekaardil (#854).
 *
 * Taustal olev vahekaart ei küsitle serverit: 20.11.2026 nginxi logis oli 57 %
 * päringutest lahtijäetud vahekaartide minutiküsitlus. Peitmisel taimer peatub;
 * ettetoomisel tehakse KOHE üks kutse ja intervall algab sealt uuesti — kasutaja
 * ei näe aegunud teatiste arvu.
 *
 * Puhas moodul (dokument ja kell süstitavad), et katta node-keskkonna ühiktestiga;
 * Reacti ümbris on `hooks/useVisibleInterval.ts`.
 */

export interface VisibilityDoc {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface VisibleIntervalOptions {
  /** Kutsu kohe käivitusel (kui vahekaart on nähtav). Vaikimisi true. */
  immediate?: boolean;
  /**
   * Ettetoomisel jäetakse kohene kutse vahele, kui eelmisest on möödas vähem —
   * kiire vahekaartide vahel klõpsamine ei tohi tekitada päringuvalangut.
   */
  minGapMs?: number;
  doc?: VisibilityDoc;
  now?: () => number;
}

export const DEFAULT_MIN_GAP_MS = 5000;

/** Käivitab intervalli; tagastab peatamise funktsiooni. */
export function startVisibleInterval(
  fn: () => void,
  intervalMs: number,
  {
    immediate = true,
    minGapMs = DEFAULT_MIN_GAP_MS,
    doc = document,
    now = Date.now,
  }: VisibleIntervalOptions = {},
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  // -Infinity: esimene ettetoomine kutsub alati, ka siis, kui käivitusel kutset ei tehtud.
  let lastRun = -Infinity;

  const run = () => {
    lastRun = now();
    fn();
  };
  const stopTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const startTimer = () => {
    stopTimer();
    timer = setInterval(run, intervalMs);
  };

  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      stopTimer();
      return;
    }
    if (now() - lastRun >= minGapMs) run();
    startTimer();
  };

  if (doc.visibilityState !== 'hidden') {
    if (immediate) run();
    startTimer();
  }
  doc.addEventListener('visibilitychange', onVisibility);

  return () => {
    stopTimer();
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
