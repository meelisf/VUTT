import { useEffect, useRef, useState } from 'react';
import type { Index } from 'meilisearch';
import { FILE_API_URL, IMAGE_BASE_URL } from '../../../config';
import { useMeiliIndex } from '../../../contexts/MeilisearchContext';
import type { LetterHit } from '../../../services/letterSearch';
import { normalizeSearchQuery } from '../../../services/searchService';
import { getPartsToc } from '../../../services/workPartsApi';
import type { WorkPart } from '../../../services/workPartsApi';

/** Kirja leht tulemusreal: pisipilt + töölaua lehenumber (klikk viib sellele lehele). */
export interface LetterPagePreview {
  page: number;
  thumb: string;
}

/** Otsingusõna tabanud leht: lõik `<mark>`-iga (sama kuju mis `letterSnippet`-i tekstil). */
export interface LetterPageHit extends LetterPagePreview {
  snippet: string;
}

/** Kirja eelvaade tulemusreal: osa (regest originaalkujul), lehed, tabatud lehed. */
export interface LetterPreview {
  part: WorkPart;
  pages: LetterPagePreview[];
  /** `null` = päringut pole (sirvimine); tühi = kiri tabas, aga mitte lehe teksti (nt nimi). */
  pageHits: LetterPageHit[] | null;
}

interface WorkEntry {
  parts: Map<string, WorkPart>;
  pageNumbers: Record<string, number>;
  tokenQuery: string;
}

/** Lehtede tekstiväljad, mida lehevaste otsib (kirja nimed/regest jäävad kirjaotsingule). */
const PAGE_TEXT_FIELDS = ['lehekylje_tekst', 'marginaalia_tekst'];
const PAGE_HITS_MAX = 3;

/** Piiratud kogu pildid vajavad HMAC-tokenit (nagu Workspace'is); avalikul pole vaja. */
async function fetchImageTokenQuery(workId: string, authToken: string | null): Promise<string> {
  if (!authToken) return '';
  try {
    const r = await fetch(`${FILE_API_URL}/work/${workId}/viewer-token`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!r.ok) return '';
    const d = await r.json();
    return d?.image_exp && d?.image_sig ? `?exp=${d.image_exp}&sig=${d.image_sig}` : '';
  } catch {
    return '';
  }
}

const thumbUrl = (workId: string, file: string, tokenQuery: string) =>
  `${IMAGE_BASE_URL}/${workId}/_thumbs/_thumb_${encodeURIComponent(file)}${tokenQuery}`;

/** Kirja lehtede seast need, mille tekst päringut tabab — `teosed`-indeksist, sama allikas mis täistekstiotsingul. */
async function fetchPageHits(
  index: Index, query: string, workId: string, pages: LetterPagePreview[], tokenQuery: string,
): Promise<LetterPageHit[]> {
  if (!pages.length) return [];
  const r = await index.search(normalizeSearchQuery(query), {
    filter: [`work_id = "${workId}"`, `lehekylje_number IN [${pages.map(p => p.page).join(', ')}]`],
    limit: PAGE_HITS_MAX,
    attributesToSearchOn: PAGE_TEXT_FIELDS,
    attributesToRetrieve: ['lehekylje_number', 'lehekylje_pilt'],
    attributesToCrop: ['lehekylje_tekst'],
    cropLength: 30,
    attributesToHighlight: PAGE_TEXT_FIELDS,
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
  });
  return r.hits
    .map(h => {
      const f = (h._formatted ?? {}) as Record<string, string | undefined>;
      const snippet = [f.lehekylje_tekst, f.marginaalia_tekst].find(s => s?.includes('<mark>')) ?? '';
      const file = String(h.lehekylje_pilt ?? '').split('/').pop() ?? '';
      return { page: Number(h.lehekylje_number), thumb: file ? thumbUrl(workId, file, tokenQuery) : '', snippet };
    })
    .filter(h => h.snippet)
    .sort((a, b) => a.page - b.page);
}

/**
 * KATSE (#526): eelvaade tuuakse teose sisukorrast, mitte `kirjad`-indeksist —
 * indeksi `abstract` on otsinguks normaliseeritud (ß → ss, et + en liidetud)
 * ja pildifaile seal ei ole. Sirvimise pisipildi nimi eeldab `{tüvi}.jpg`;
 * puuduv pilt peidetakse renderduses. Kui suund jääb, kolivad väljad indeksisse.
 */
export function useLetterPreviews(
  hits: LetterHit[], query: string, authToken: string | null,
): Map<string, LetterPreview> {
  const index = useMeiliIndex();
  // Vahemälu elab komponendi eluea — kasutajapõhine (token), mitte moodulitasandil.
  const cache = useRef(new Map<string, Promise<WorkEntry | null>>());
  const [previews, setPreviews] = useState(new Map<string, LetterPreview>());
  const hitsKey = hits.map(h => h.id).join(',');
  const q = query.trim();

  useEffect(() => {
    cache.current.clear();
  }, [authToken]);

  useEffect(() => {
    if (!hitsKey) return;
    let cancelled = false;
    const load = (workId: string) => {
      let p = cache.current.get(workId);
      if (!p) {
        p = Promise.all([getPartsToc(workId, authToken), fetchImageTokenQuery(workId, authToken)])
          .then(([toc, tokenQuery]) => ({
            parts: new Map(toc.parts.map(x => [x.id, x])), pageNumbers: toc.pageNumbers, tokenQuery,
          }))
          .catch(() => null);
        cache.current.set(workId, p);
      }
      return p;
    };
    (async () => {
      const workIds = [...new Set(hits.map(h => h.work_id))];
      const byWork = new Map(await Promise.all(workIds.map(async id => [id, await load(id)] as const)));
      const built = await Promise.all(hits.map(async hit => {
        const entry = byWork.get(hit.work_id);
        const part = entry?.parts.get(hit.part_id);
        if (!entry || !part) return null;
        // Osa lehed on HULK (ADR 0057) — järjestus tuleb lehenumbritest.
        const pages = part.pages
          .filter(stem => entry.pageNumbers[stem] != null)
          .map(stem => ({ page: entry.pageNumbers[stem], thumb: thumbUrl(hit.work_id, `${stem}.jpg`, entry.tokenQuery) }))
          .sort((a, b) => a.page - b.page);
        const pageHits = q && index
          ? await fetchPageHits(index, q, hit.work_id, pages, entry.tokenQuery).catch(() => [])
          : null;
        return [hit.id, { part, pages, pageHits }] as const;
      }));
      if (!cancelled) setPreviews(new Map(built.filter((x): x is NonNullable<typeof x> => !!x)));
    })();
    return () => { cancelled = true; };
    // `hits` massiiv on igal päringul uus — võtmeks on tulemuste ID-d.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitsKey, q, index, authToken]);

  return previews;
}
