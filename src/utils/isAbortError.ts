/**
 * Kas viga on päringu KATKESTUS, mitte serveri tõrge?
 *
 * `fetchWithTimeout` katkestab päringu vaikimisi 10 s pealt. Katkestus
 * tähendab, et vastust ei saadud — MITTE seda, et server tööd ei teinud:
 * `run_in_threadpool` lõime ei tühistata ja kirjutus läheb lõpuni (ADR 0036
 * sama õppetund impordist). Mitte-idempotentsel POST-il on vahe oluline,
 * sest „ebaõnnestus" ajab kasutaja kordusklikile ja tekitab duplikaadi.
 */
export const isAbortError = (error: unknown): boolean =>
  (typeof DOMException !== 'undefined'
    && error instanceof DOMException && error.name === 'AbortError')
  || (typeof error === 'object' && error !== null
    && (error as { name?: string }).name === 'AbortError');
