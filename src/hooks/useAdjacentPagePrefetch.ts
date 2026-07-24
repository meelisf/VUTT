import { useEffect, useRef } from 'react';
import type { Index } from 'meilisearch';
import { getPage } from '../services/pageService';

interface UseAdjacentPagePrefetchParams {
  index: Index | null | undefined;
  workId: string | undefined;
  currentPageNum: number;
  pageCount: number | undefined;
  /** Lisab piiratud teose pildi-URL-ile HMAC tokeni. */
  appendImageToken: (url: string) => string;
  /** Eellaadimine ainult siis, kui praegune leht on kohal ja viga puudub. */
  enabled: boolean;
}

/**
 * Eellaeb kõrvallehtede skaneeringud brauseri vahemällu, et järjest lappamine
 * oleks hetkeline.
 *
 * **Ainult pilt, mitte lehe kirje.** Meili päring lehe kohta on niigi ~10 ms,
 * skaneering aga sadu kilobaite — kogu tajutav viivitus tuleb pildist. Teksti
 * teadlikult ei cache'ita: vahemälust serveeritud vananenud transkriptsioon
 * oleks transkribeerimistööriistas korrektsusviga, mitte jõudlusvõit.
 *
 * Pildid on pika cache-elueaga (image server `max-age=86400`, nginx 30 p), seega
 * eellaetud pilt on tegeliku pöörde ajaks brauseri vahemälus.
 */
export function useAdjacentPagePrefetch({
  index,
  workId,
  currentPageNum,
  pageCount,
  appendImageToken,
  enabled,
}: UseAdjacentPagePrefetchParams): void {
  // Juba soojendatud URL-id — väldib sama pildi korduvat päringut edasi-tagasi
  // lappamisel. Puhastatakse teose vahetusel.
  const warmedRef = useRef<{ workId: string | undefined; urls: Set<string> }>({
    workId: undefined,
    urls: new Set(),
  });

  useEffect(() => {
    if (!enabled || !index || !workId) return;
    if (shouldSkipPrefetch()) return;

    if (warmedRef.current.workId !== workId) {
      warmedRef.current = { workId, urls: new Set() };
    }

    const targets = adjacentPageTargets(currentPageNum, pageCount);
    if (targets.length === 0) return;

    let cancelled = false;

    const warm = async () => {
      for (const pageNum of targets) {
        if (cancelled) return;
        try {
          const pageData = await getPage(index, workId, pageNum);
          if (cancelled || !pageData?.image_url) continue;

          const url = appendImageToken(pageData.image_url);
          if (warmedRef.current.urls.has(url)) continue;
          warmedRef.current.urls.add(url);

          // `new Image()` tõmbab pildi vahemällu ilma DOM-i puutumata. Vead
          // ignoreeritakse vaikselt — eellaadimine ei tohi kunagi UI-d mõjutada.
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
        } catch {
          /* eellaadimine on parim-pingutus */
        }
      }
    };

    // Ootame jõudeoleku ära, et eellaadimine ei võistleks praeguse lehe
    // renderdusega ega selle pildiga.
    const idle = scheduleWhenIdle(warm);

    return () => {
      // `cancelled` peatab uute päringute alustamise. Juba lennus olevat pilti
      // ei katkestata teadlikult: see on suure tõenäosusega just see leht, kuhu
      // kasutaja liikus, ja `img.src = ''` võib mõnes brauseris hoopis
      // dokumendi-URL-i pärida.
      cancelled = true;
      idle.cancel();
    };
  }, [index, workId, currentPageNum, pageCount, appendImageToken, enabled]);
}

/**
 * Eellaetavad lehenumbrid, järjekorras. Edasi enne tagasi — järjest lappamine on
 * tavalisem kui tagasi kerimine. Piirid: leht 1 ja teose viimane leht.
 *
 * `pageCount === undefined` tähendab "veel teadmata" (teose metaandmed pole
 * jõudnud laadida) — siis piirame ainult alt, et esimene pööre ei jääks ootama.
 */
export function adjacentPageTargets(currentPageNum: number, pageCount: number | undefined): number[] {
  if (!Number.isFinite(currentPageNum) || currentPageNum < 1) return [];
  return [currentPageNum + 1, currentPageNum - 1].filter(
    n => n >= 1 && (pageCount === undefined || pageCount <= 0 || n <= pageCount),
  );
}

/** Andmesäästurežiim või aeglane ühendus — ära raiska kasutaja mahtu. */
function shouldSkipPrefetch(): boolean {
  const conn = (navigator as any)?.connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  return ['slow-2g', '2g'].includes(conn.effectiveType);
}

function scheduleWhenIdle(fn: () => void): { cancel: () => void } {
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') {
    const id = ric(fn, { timeout: 2000 });
    return { cancel: () => (window as any).cancelIdleCallback?.(id) };
  }
  const id = window.setTimeout(fn, 300);
  return { cancel: () => window.clearTimeout(id) };
}
