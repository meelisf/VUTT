/**
 * Kirja tulemusrea kuvaloogika (#526) — puhas, et varukuva ahel oleks testitav.
 * Puuduvat välja ei näidata ega asendata oletusega („[teadmata]").
 */
import type { LetterHit } from '../../../services/letterSearch';
import type { WorkDating } from '../../../utils/workDating';

type T = (key: string, opts?: Record<string, unknown>) => string;

const INCIPIT_MAX = 80;

/** Kuupäev; vahemik jääb vahemikuks (alguskuupäev üksi annaks eksliku täpsuse).
 *  Allikakuju (`source_text`) EI asenda kuupäeva: see võib kanda toimetaja märkust —
 *  ta on tulemusreal hõljuv vihje (LetterResults). */
export function formatLetterDating(dating: WorkDating | undefined): string | null {
  if (!dating?.start) return null;
  return dating.end ? `${dating.start}–${dating.end}` : dating.start;
}

const pair = (from: string, to: string): string | null => {
  if (from && to) return `${from} → ${to}`;
  if (from) return from;
  if (to) return `→ ${to}`;
  return null;
};

export function letterHeadline(hit: LetterHit, t: T): string {
  const segments = [
    pair(hit.authors.join(', '), hit.addressees.join(', ')),
    formatLetterDating(hit.dating),
    pair(hit.place_from, hit.place_to),
  ].filter((s): s is string => !!s);
  if (segments.length) return segments.join(' · ');
  if (hit.title) return hit.title;
  if (hit.incipit) return hit.incipit.length > INCIPIT_MAX ? `${hit.incipit.slice(0, INCIPIT_MAX)}…` : hit.incipit;
  return t('letters.pageFallback', { page: hit.first_page });
}

const hasMark = (s?: string): s is string => !!s && s.includes('<mark>');

/** Regesti katke, kui vaste on regestis; muidu null (nimevaste, tekstivaste). */
export function abstractSnippet(hit: LetterHit): string | null {
  return hasMark(hit._formatted?.abstract) ? hit._formatted!.abstract! : null;
}

/** Lehe katke: `page` = töölaua lehenumber; `null`, kui indeksis lehti pole (enne taasehitust). */
export interface PageExcerpt {
  page: number | null;
  text: string;
}

/** Konteksti märke enne/pärast vastet (Meili `cropLength: 30` sõna ≈ sama maht). */
const CONTEXT_BEFORE = 80;
const CONTEXT_AFTER = 160;
const EXCERPTS_MAX = 3;

/**
 * Vaste asukohad kirja tekstis → katked lehtede kaupa (#526).
 *
 * Meili annab asukohad UTF-8 BAITIDES; ka `pages[].start` on baitides, nii et
 * leht leitakse baitide võrdlusega ja alles katke lõikamiseks teisendatakse
 * JS-i indeksiks. Kirjaindeks ja lehtede indeks sobitavad erinevalt (kirjavea
 * tolerants), seega lehte EI otsita teisest indeksist. Katke ei ulatu üle
 * lehe piiri. `hitPages` = kõik tabatud lehed (riba esiletõst), katkeid kuni 3.
 */
export function letterPageExcerpts(hit: LetterHit): { excerpts: PageExcerpt[]; hitPages: number[] } {
  const text = hit.letter_text ?? '';
  const matches = (hit._matchesPosition?.letter_text ?? []).filter(m => m.length > 0);
  if (!text || !matches.length) return { excerpts: [], hitPages: [] };

  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const toIndex = (b: number) => decoder.decode(bytes.subarray(0, Math.min(b, bytes.length))).length;
  const pages = [...(hit.pages ?? [])].sort((a, b) => a.start - b.start);
  // Viimane leht, mis algab vaste ees; tühi leht jagab järgmise algust ja jääb alla.
  const pageAt = (b: number) => {
    let found = -1;
    pages.forEach((p, i) => { if (p.start <= b) found = i; });
    return found;
  };

  const byPage = new Map<number, { start: number; end: number }[]>();
  for (const m of [...matches].sort((a, b) => a.start - b.start)) {
    const i = pageAt(m.start);
    const list = byPage.get(i) ?? [];
    list.push({ start: toIndex(m.start), end: toIndex(m.start + m.length) });
    byPage.set(i, list);
  }

  const excerpts: PageExcerpt[] = [];
  for (const [i, ms] of byPage) {
    if (excerpts.length >= EXCERPTS_MAX) break;
    const lo = i >= 0 ? toIndex(pages[i].start) : 0;
    const hi = i >= 0 && i + 1 < pages.length ? toIndex(pages[i + 1].start) : text.length;
    let from = Math.max(lo, ms[0].start - CONTEXT_BEFORE);
    let to = Math.min(hi, ms[0].end + CONTEXT_AFTER);
    // Sõnapiirile, et katke ei algaks ega lõppeks poolikust sõnast.
    if (from > lo) {
      const ws = text.slice(from, ms[0].start).search(/\s/);
      if (ws >= 0) from += ws + 1;
    }
    if (to < hi) {
      const tail = text.slice(ms[0].end, to);
      const ws = Math.max(tail.lastIndexOf(' '), tail.lastIndexOf('\n'));
      if (ws >= 0) to = ms[0].end + ws;
    }
    let out = '';
    let pos = from;
    for (const m of ms) {
      if (m.start < pos || m.end > to) continue;
      out += text.slice(pos, m.start) + '<mark>' + text.slice(m.start, m.end) + '</mark>';
      pos = m.end;
    }
    out += text.slice(pos, to);
    const body = out.replace(/\s+/g, ' ').trim();
    excerpts.push({
      page: i >= 0 ? pages[i].n : null,
      text: `${from > lo ? '…' : ''}${body}${to < hi ? '…' : ''}`,
    });
  }
  const hitPages = [...byPage.keys()].filter(i => i >= 0).map(i => pages[i].n);
  return { excerpts, hitPages };
}

/** `<mark>` tükkideks — renderdus ilma dangerouslySetInnerHTML-ita (ülejäänu on tekst). */
export function splitMarks(s: string): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  const re = /<mark>(.*?)<\/mark>/gs;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index), mark: false });
    out.push({ text: m[1], mark: true });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), mark: false });
  return out;
}
