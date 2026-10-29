import { lazy, type ComponentType } from 'react';

// Pärast deploy'd puuduvad vanad räsistatud chunk-failid (`rsync --delete`).
// Kui leht oli deploy ajal lahti, kukub iga hilisem laisk import — uus
// index.html toob uued failinimed. Lehte laetakse uuesti ÜKS kord: kui ka
// värske leht ei leia chunki, on viga päris ja peab jõudma veapiiri/vealogisse,
// mitte jääma lõputusse uuestilaadimisse.

const RELOAD_KEY = 'vutt_stale_chunk_reload_at';
const RELOAD_GUARD_MS = 30_000;

/** Laeb lehe uuesti, kui viimasest katsest on möödas piisavalt aega; `false` = ei laadinud. */
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Salvestuseta ei saa tsüklit vältida — parem viga kui lõputu uuestilaadimine.
    return false;
  }
  window.location.reload();
  return true;
}

/** `React.lazy`, mis vananenud chunki korral laeb lehe uuesti (marsruudid JA pesastatud komponendid). */
export function lazyRetry<T extends ComponentType<any>>(importFn: () => Promise<{ default: T }>) {
  return lazy(() =>
    importFn().catch((error) => {
      // Ootel promise: React ei näita enne uuestilaadimist veaekraani.
      if (reloadForStaleChunk()) return new Promise<{ default: T }>(() => {});
      throw error;
    })
  );
}

/** Vite'i eellaadimise viga (modulepreload/CSS) — sama käsitlus kui laisal impordil. */
export function installStaleChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForStaleChunk()) event.preventDefault();
  });
}
