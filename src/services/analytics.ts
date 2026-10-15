/**
 * Umami sündmus (skript laeb index.html-is). Analüütika ei tohi KUNAGI
 * rakendust murda: puuduv skript (adblock, dev) või viga neelatakse.
 */
export function trackEvent(name: string, data?: Record<string, string | number>): void {
  try {
    (window as unknown as { umami?: { track?: (n: string, d?: Record<string, string | number>) => void } })
      .umami?.track?.(name, data);
  } catch {
    // tahtlikult vaikne
  }
}
