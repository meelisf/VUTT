/**
 * Taustatöö olekupoll (#675 B) — üks reegel kõigile poll-tsüklitele.
 *
 * - `ApiError` (server vastas HTTP-veaga: 401/403/404/500) on LÕPLIK → stopp.
 * - Muu viga (võrk, timeout) → uus katse `retryMs` pärast, kuni `maxErrors`
 *   järjestikust viga; edukas vastus nullib loenduri.
 * - `alive()` kontrollitakse iga ootamise ja iga vastuse järel — false →
 *   tsükkel lõpeb vaikselt (lehe vahetus, uuem töö, lahtimonteerimine).
 */
import { useCallback, useEffect, useRef } from 'react';
import { ApiError } from '../services/apiClient';

export interface PollOptions<T> {
  request: () => Promise<T>;
  /** true → töö käib, poll jätkab. */
  isRunning: (status: T) => boolean;
  /** Iga saadud olek, ka viimane. */
  onStatus?: (status: T) => void;
  intervalMs: number;
  /** Esimese päringu viide; vaikimisi `intervalMs`. */
  firstDelayMs?: number;
  /** Viide pärast mitte-lõplikku viga; vaikimisi `intervalMs`. */
  retryMs?: number;
  maxErrors?: number;
  alive?: () => boolean;
}

export type PollResult<T> =
  | { kind: 'finished'; status: T }
  | { kind: 'failed'; error: unknown }
  | { kind: 'cancelled' };

export const MAX_POLL_ERRORS = 10;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function pollUntil<T>({
  request, isRunning, onStatus, intervalMs, firstDelayMs = intervalMs,
  retryMs = intervalMs, maxErrors = MAX_POLL_ERRORS, alive = () => true,
}: PollOptions<T>): Promise<PollResult<T>> {
  let delay = firstDelayMs;
  let errors = 0;
  for (;;) {
    if (delay > 0) await sleep(delay);
    if (!alive()) return { kind: 'cancelled' };
    let status: T;
    try {
      status = await request();
    } catch (error) {
      if (!alive()) return { kind: 'cancelled' };
      if (error instanceof ApiError || ++errors >= maxErrors) return { kind: 'failed', error };
      delay = retryMs;
      continue;
    }
    if (!alive()) return { kind: 'cancelled' };
    errors = 0;
    onStatus?.(status);
    if (!isRunning(status)) return { kind: 'finished', status };
    delay = intervalMs;
  }
}

/** `pollUntil`, mis lõpeb ka komponendi lahtimonteerimisel. Stabiilne identiteet. */
export function useJobPoll() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  return useCallback(<T,>(opts: PollOptions<T>) => pollUntil({
    ...opts,
    alive: () => mountedRef.current && (opts.alive ? opts.alive() : true),
  }), []);
}
