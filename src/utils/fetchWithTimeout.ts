// Fetch wrapper mis lisab automaatse timeout'i.
// Kui server ei vasta etteantud aja jooksul, katkestatakse päring AbortError'iga.

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = 10000, ...fetchInit } = init || {};

  const controller = new AbortController();
  // Kui väljakutsuja juba andis signal'i, kuulame ka seda
  if (fetchInit.signal) {
    fetchInit.signal.addEventListener('abort', () => controller.abort());
  }

  const timeoutId = setTimeout(() => controller.abort(), timeout);

  return fetch(input, { ...fetchInit, signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
}
