// src/prosopography/utils/personSources.ts
/**
 * Isikukaardi „Allikad ja bibliograafia" kirjed (ADR 0078): vabatekst või viide
 * VUTT-i teosele/osale. Pealkiri ja osa nimi tulevad teoselt vaate ajal — kaardile
 * neid ei kopeerita.
 */
import type { PersonSource } from '../types';

/** Osa kuvainfo: liigi silt („Kiri"), osa pealkiri ja esimese lehe number. */
export interface SourcePartInfo { kindLabel: string; title: string | null; firstPage: number | null }
/** work_id → part_id → osa kuvainfo. */
export type SourcePartsMap = Record<string, Record<string, SourcePartInfo>>;

export const isVuttSource = (s: PersonSource | null | undefined): s is PersonSource & { work_id: string } =>
  Boolean(s && typeof s.work_id === 'string' && s.work_id);

/** Allikakirjete unikaalsed work_id-d (pealkirjade päringuks). */
export function sourceWorkIds(sources: PersonSource[] | null | undefined): string[] {
  return [...new Set((sources ?? []).filter(isVuttSource).map(s => s.work_id))];
}

/** Teosed, mille osa nime on vaja (kirjel on part_id). */
export function sourcePartWorkIds(sources: PersonSource[] | null | undefined): string[] {
  return [...new Set((sources ?? []).filter(s => isVuttSource(s) && s.part_id).map(s => s.work_id!))];
}

/** Sisemine marsruut: kirje leht → osa esimene leht → teos. */
export function sourceHref(source: PersonSource & { work_id: string }, parts: SourcePartsMap): string {
  const base = `/work/${encodeURIComponent(source.work_id)}`;
  const page = source.page
    ?? (source.part_id ? parts[source.work_id]?.[source.part_id]?.firstPage : null);
  return page ? `${base}/${page}` : base;
}

/** Kuvatav kirje: tühi (ei teksti ega teost) jääb välja. */
export const hasSourceContent = (s: PersonSource | null | undefined): boolean =>
  Boolean(s && (isVuttSource(s) || (typeof s.text === 'string' && s.text.trim())));

/** Osa silt vaates: liik + pealkiri, aga pealkiri jääb ära, kui see kordab teose
 *  pealkirja algust (jutlus kannab sageli kogu trükise pealkirja). */
export function partLabel(part: SourcePartInfo, workTitle: string | undefined): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const title = part.title?.trim();
  if (!title) return part.kindLabel;
  const head = norm(title).slice(0, 40);
  const redundant = Boolean(workTitle && head && norm(workTitle).startsWith(head));
  return redundant ? part.kindLabel : `${part.kindLabel} · ${title}`;
}

/** Kirjanduse lühivõti: „Küng 2010: Enn Küng. …" → võti „Küng 2010" + ülejäänu.
 *  Ainult lühike (≤ 40 märki) koolonieelne osa, millele järgneb tühik — URL ei sobi. */
export function splitCitationKey(text: string): { key: string | null; rest: string } {
  const m = /^([^:\n]{1,40}):\s+([\s\S]+)$/.exec(text.trim());
  return m ? { key: m[1].trim(), rest: m[2] } : { key: null, rest: text.trim() };
}

export type TextPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const URL_OR_DOI = /(https?:\/\/[^\s]+)|\bDOI:?\s+(10\.\d{4,9}\/[^\s]+)/gi;
const TRAILING = /[.,;:)\]]+$/;

/** Vabateksti URL-id ja DOI-d lingiks: URL-i tekst = domeen, DOI tekst = DOI ise.
 *  Lauselõpu kirjavahemärk jääb lingist välja. */
export function linkifyCitation(text: string): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_OR_DOI)) {
    const raw = m[1] ?? m[2];
    const core = raw.replace(TRAILING, '');
    const start = m.index! + m[0].length - raw.length;
    if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index!) });
    if (m[1]) {
      let host = core;
      try { host = new URL(core).hostname.replace(/^www\./, ''); } catch { /* jääb URL-iks */ }
      out.push({ kind: 'link', text: host, href: core });
    } else {
      out.push({ kind: 'text', text: text.slice(m.index!, start) });
      out.push({ kind: 'link', text: core, href: `https://doi.org/${core}` });
    }
    last = start + core.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
