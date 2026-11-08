// src/prosopography/utils/personSources.ts
/**
 * Isikukaardi „Allikad ja bibliograafia" kirjed (ADR 0078): vabatekst või viide
 * VUTT-i teosele/osale. Pealkiri ja osa nimi tulevad teoselt vaate ajal — kaardile
 * neid ei kopeerita.
 */
import type { PersonSource } from '../types';

/** Osa kuvainfo: silt („Proosatekst · Personalia") + esimese lehe number. */
export interface SourcePartInfo { label: string; firstPage: number | null }
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
