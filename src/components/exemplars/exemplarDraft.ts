/**
 * Eksemplari kirje mustand ja selle teisendus PUT/POST-i kujule (ADR 0076 p 5).
 * Tõstetud metaandmete modaali endisest eksemplaride sektsioonist: üks vormi loogika, üks kirjutustee.
 */
import type { Exemplar, ExemplarConvolute, ExemplarReproduction, ReproductionKind } from '../../types';
import type { ExemplarInput } from '../../services/workApi';

export const TEXT_FIELDS = ['holder', 'shelfmark', 'url', 'condition', 'binding', 'provenance', 'notes'] as const;
export const MORE_FIELDS = ['condition', 'binding', 'provenance', 'notes'] as const;
// Konvoluudi väljad (#702, ADR 0076 p 6): koht ja arv on mustandis stringid, et lahtri saaks tühjendada.
export const CONV_FIELDS = ['convReference', 'convPosition', 'convTotal', 'convContents'] as const;
// Reproduktsioon (ADR 0076 §11): liik ('' = originaal) ja originaali eksemplari id ('' = teadmata).
export const REP_FIELDS = ['repKind', 'repOf'] as const;
export type Draft = Record<(typeof TEXT_FIELDS)[number] | (typeof CONV_FIELDS)[number] | (typeof REP_FIELDS)[number], string>;
export const DRAFT_KEYS = [...TEXT_FIELDS, ...CONV_FIELDS, ...REP_FIELDS] as const;

export const toDraft = (x?: Exemplar): Draft => ({
  holder: x?.holder ?? '',
  shelfmark: x?.shelfmark ?? '',
  url: x?.url ?? '',
  condition: x?.condition ?? '',
  binding: x?.binding ?? '',
  provenance: x?.provenance ?? '',
  notes: x?.notes ?? '',
  convReference: x?.convolute?.reference ?? '',
  convPosition: x?.convolute?.position != null ? String(x.convolute.position) : '',
  convTotal: x?.convolute?.total != null ? String(x.convolute.total) : '',
  convContents: x?.convolute?.contents ?? '',
  repKind: x?.reproduction?.kind ?? '',
  repOf: x?.reproduction?.of ?? '',
});

/** Mustandi reproduktsioon PUT-i kujule: liigita = originaal (`null`). */
export const reproductionFromDraft = (d: Draft): ExemplarReproduction | null => {
  if (!d.repKind) return null;
  return { kind: d.repKind as ReproductionKind, ...(d.repOf ? { of: d.repOf } : {}) };
};

export const sameDraft = (a: Draft, b: Draft) => DRAFT_KEYS.every(f => a[f].trim() === b[f].trim());

/** Tühi → undefined, täisarv → number, muu → NaN (vormi viga). */
export const parseCount = (raw: string): number | undefined => {
  const v = raw.trim();
  if (!v) return undefined;
  return /^\d+$/.test(v) ? Number(v) : NaN;
};

/**
 * Mustandi konvoluut PUT-i kujule. Kõik väljad tühjad = märge maha (`null`);
 * kohaviiteta, aga muu väljaga mustand on vormi viga (`noReference`).
 * Koha ja arvu kooskõla (koht < arv) kontrollib server — klient ainult parsib.
 */
export function convoluteFromDraft(d: Draft): ExemplarConvolute | null | 'invalid' | 'noReference' {
  const reference = d.convReference.trim();
  if (!reference) {
    // Märke eemaldamine on tahtlik ainult siis, kui kõik konvoluudiväljad on tühjad —
    // muidu kaoks unustatud kohaviida tõttu sisestatud sisukord vaikselt.
    const rest = [d.convPosition, d.convTotal, d.convContents].some(v => v.trim());
    return rest ? 'noReference' : null;
  }
  const position = parseCount(d.convPosition);
  const total = parseCount(d.convTotal);
  if (Number.isNaN(position) || Number.isNaN(total)) return 'invalid';
  const out: ExemplarConvolute = { reference };
  if (position !== undefined) out.position = position;
  if (total !== undefined) out.total = total;
  const contents = d.convContents.trim();
  if (contents) out.contents = contents;
  return out;
}

/** Mustand → kirjutuse keha. Kõik väljad kaasa: tühi string eemaldab serveris välja. */
export const bodyFromDraft = (d: Draft, convolute: ExemplarConvolute | null): ExemplarInput => ({
  ...Object.fromEntries(TEXT_FIELDS.map(f => [f, d[f].trim()])), convolute, reproduction: reproductionFromDraft(d),
});
