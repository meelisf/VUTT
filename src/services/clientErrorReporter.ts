import { FILE_API_URL } from '../config';

/**
 * Saadab kliendipoolsed vead serverisse (#133).
 *
 * Enne seda oli ainus signaal „kasutaja kirjutab" — ja 2026-09-15 tuli nii
 * välja kaks tootmisviga, millest üks tabas iga kasutajat, kes seoste kaardil
 * isikule klikkis.
 *
 * **Raportöör ei tohi ISE vigu tekitada.** Iga tõrge neelatakse vaikselt: kui
 * raporteerimine viskaks, tekitaks veateade uue veateate ja kasutaja näeks
 * silmust selle asemel, mida ta tegema tuli.
 */

const ENDPOINT = `${FILE_API_URL}/client-error`;

/** Sama viga korduvalt (nt render-tsükkel) ei tohi logi üle ujutada. */
const DEDUPE_WINDOW_MS = 60_000;
/** Ülempiir ÜHE lehesessiooni kohta — katkine tsükkel ei tohi tulistada. */
const MAX_PER_SESSION = 10;

const seen = new Map<string, number>();
let sent = 0;

export type ErrorSource = 'boundary' | 'window' | 'promise';

export interface ClientErrorPayload {
  message: string;
  stack?: string;
  source: ErrorSource;
}

function shouldSend(key: string): boolean {
  if (sent >= MAX_PER_SESSION) return false;
  const now = Date.now();
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  seen.set(key, now);
  return true;
}

export function reportClientError({ message, stack, source }: ClientErrorPayload): void {
  try {
    const text = (message || '').trim();
    if (!text) return;
    // Dedupe võti on teade + päritolu, MITTE URL: sama viga eri lehtedel on
    // sama viga, ja URL-i muutumine ei tohi lubada tal uuesti tulistada.
    if (!shouldSend(`${source}:${text}`)) return;
    sent += 1;

    const body = JSON.stringify({
      message: text,
      stack: stack ?? null,
      // URL-i paneb klient, sest server näeb ainult seda endpointi. Päringustring
      // tuleb kaasa — just tema ütles y5fcky puhul, MIS lehel viga juhtus.
      url: window.location.pathname + window.location.search,
      user_agent: navigator.userAgent,
      source,
    });

    // `keepalive`: viga võib tabada vahetult enne lehelt lahkumist ja tavaline
    // fetch katkeks siis koos lehega.
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      // Token EI OLE siin: endpoint on tahtlikult anonüümne ja server loeb
      // kasutaja päisest ise, kui ta juhtub olema.
    }).catch(() => undefined);
  } catch {
    // Vaikus on siin ainus õige käitumine — vt mooduli päis.
  }
}

/**
 * Ühendab globaalsed kuulajad. Kutsutakse ÜKS kord rakenduse käivitamisel.
 *
 * `window.onerror` katab selle, mida React error boundary ei näe: sündmuse
 * käsitlejad, `setTimeout`, ja kõik väljaspool renderdust. Boundary raporteerib
 * ise (`RouteErrorBoundary`).
 */
export function installGlobalErrorReporting(): void {
  window.addEventListener('error', event => {
    reportClientError({
      message: event.message || String(event.error ?? 'tundmatu viga'),
      stack: event.error instanceof Error ? event.error.stack : undefined,
      source: 'window',
    });
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    reportClientError({
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      source: 'promise',
    });
  });
}
