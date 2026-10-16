import type { Annotation, PageStatus, TextAnnotation } from '../../types';
import type { LinkedEntity } from '../../types/LinkedEntity';
import type { EditorSavedState } from './useEditorSave';

/**
 * Lehe salvestuse kolmesuunaline liitmine (#455, ADR 0054) — kliendi pool.
 *
 * Klient saadab `/save`-iga baasseisu: lehe väljad nii, nagu ta need laadis
 * või viimati salvestas. Server liidab selle vastu kettal olevaga; päris
 * kokkupõrke korral vastab 409 ja kaasa tuleb serveri praegune seis.
 */
export interface PageFields {
  text_content: string;
  status: PageStatus;
  page_tags: (string | LinkedEntity)[];
  comments: Annotation[];
  text_annotations: TextAnnotation[];
}

/** Salvestuse tulemus redaktorile: `merged` = server liitis ketta seisu, redaktor võtab üle. */
export interface SaveOutcome {
  merged: PageFields | null;
}

/** Teksti tükk kokkupõrke vastuses (#612): tükid katavad kogu teksti. */
export type TextChunk =
  | { kind: 'ok'; text: string }
  | { kind: 'conflict'; base: string; mine: string; theirs: string };

/** Kasutaja valik ühe põrkuva tüki kohta. `both` = enne tema, siis minu. */
export type ChunkChoice = 'mine' | 'theirs' | 'both';

/** Lehe viimane muutja serveris (git), dialoogi jaoks. */
export interface TheirsLast {
  author: string;
  date: string;
}

/** Kokkupõrge: midagi ei salvestatud. `fields`: `text`, `status`, `page_tags`, `comments:<id>`, `annotations:<id>`. */
export class PageConflictError extends Error {
  constructor(
    public fields: string[],
    public current: PageFields,
    public textChunks: TextChunk[] | null = null,
    public theirsLast: TheirsLast | null = null,
  ) {
    super(`Lehe salvestus põrkus: ${fields.join(', ')}`);
    this.name = 'PageConflictError';
  }
}

export function baseFromSavedState(saved: EditorSavedState): PageFields {
  return {
    text_content: saved.text,
    status: saved.status,
    page_tags: saved.page_tags,
    comments: saved.comments,
    text_annotations: saved.text_annotations,
  };
}

/** 409 vastuse keha → `PageConflictError`; muu → null (tavaline viga). */
export function conflictFromResponse(status: number, body: unknown): PageConflictError | null {
  if (status !== 409 || !body || typeof body !== 'object') return null;
  const detail = (body as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as { conflict?: unknown; fields?: unknown; current?: unknown; text_chunks?: unknown; theirs_last?: unknown };
  if (d.conflict !== true || !Array.isArray(d.fields) || !d.current || typeof d.current !== 'object') return null;
  return new PageConflictError(
    d.fields.map(String), d.current as PageFields, parseChunks(d.text_chunks), parseTheirsLast(d.theirs_last),
  );
}

function parseChunks(raw: unknown): TextChunk[] | null {
  if (!Array.isArray(raw)) return null;
  const str = (v: unknown) => typeof v === 'string';
  const chunks: TextChunk[] = [];
  for (const c of raw) {
    if (c && c.kind === 'ok' && str(c.text)) chunks.push({ kind: 'ok', text: c.text });
    else if (c && c.kind === 'conflict' && str(c.base) && str(c.mine) && str(c.theirs)) {
      chunks.push({ kind: 'conflict', base: c.base, mine: c.mine, theirs: c.theirs });
    } else return null;   // tundmatu kuju → dialoog langeb tagasi tervikvalikule
  }
  return chunks.some(c => c.kind === 'conflict') ? chunks : null;
}

function parseTheirsLast(raw: unknown): TheirsLast | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { author?: unknown; date?: unknown };
  return typeof r.author === 'string' && typeof r.date === 'string' ? { author: r.author, date: r.date } : null;
}

/**
 * Tükid + valikud → redaktori tekst. `choices[i]` käib i-nda PÕRKUVA tüki kohta.
 * `both`: enne tema read, siis minu — reavahetus vahele, kui tema tükk ei lõpe sellega.
 */
export function assembleChunks(chunks: TextChunk[], choices: ChunkChoice[]): string {
  let i = 0;
  return chunks.map(c => {
    if (c.kind === 'ok') return c.text;
    const valik = choices[i++];
    if (valik === 'theirs') return c.theirs;
    if (valik === 'both') {
      const vahe = c.theirs && c.mine && !c.theirs.endsWith('\n') ? '\n' : '';
      return c.theirs + vahe + c.mine;
    }
    return c.mine;
  }).join('');
}

const ANN_TAG_RE = /<ann(\d+)>/g;

function annIdsInText(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(ANN_TAG_RE), m => m[1]));
}

/**
 * Tükkidest kokku pandud teksti annotatsioonikirjed: tekstis oleva ankru kirje
 * tuleb minult, kui mul see on, muidu serverist (tema tükist tulnud ankur).
 * Minu kirje, mille ankur jäi minu valikuga välja, kukub ära; minu juba enne
 * ankruta olnud kirje (vana orb) jääb — see pole selle valiku süü.
 */
export function annotationsForText(
  text: string, mine: TextAnnotation[], theirs: TextAnnotation[], mineText: string,
): TextAnnotation[] {
  const tekstis = annIdsInText(text);
  const minuTekstis = annIdsInText(mineText);
  const tulemus = mine.filter(a => tekstis.has(String(a.id)) || !minuTekstis.has(String(a.id)));
  const olemas = new Set(tulemus.map(a => String(a.id)));
  for (const a of theirs) {
    if (tekstis.has(String(a.id)) && !olemas.has(String(a.id))) tulemus.push(a);
  }
  return tulemus;
}

export interface DiffSegment {
  text: string;
  changed: boolean;
}

/**
 * Sõnatasemel erinevus kahe tüki vahel esiletõstuks (LCS). Transkriptsioonis
 * on vahe tihti üks täht (ſ/s, u/v) — ilma esiletõstuta ei leia silm seda üles.
 * Suurel tükil loobutakse (ruutkeerukus), siis on kõik `changed: false`.
 */
export function wordDiff(a: string, b: string): { a: DiffSegment[]; b: DiffSegment[] } {
  const ta = a.split(/(\s+)/).filter(Boolean);
  const tb = b.split(/(\s+)/).filter(Boolean);
  if (ta.length * tb.length > 250_000) {
    return { a: [{ text: a, changed: false }], b: [{ text: b, changed: false }] };
  }
  const n = ta.length, m = tb.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = ta[i] === tb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const outA: DiffSegment[] = [];
  const outB: DiffSegment[] = [];
  const push = (out: DiffSegment[], text: string, changed: boolean) => {
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.text += text;
    else out.push({ text, changed });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) { push(outA, ta[i++], false); push(outB, tb[j++], false); }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push(outA, ta[i++], true);
    else push(outB, tb[j++], true);
  }
  while (i < n) push(outA, ta[i++], true);
  while (j < m) push(outB, tb[j++], true);
  return { a: outA, b: outB };
}

/**
 * „Salvesta minu versioon": uus baas = vana baas, kus KONFLIKTIS üksused on
 * serveri praegused. Korduval salvestusel näeb server neis „nemad ei muutnud"
 * → võidab minu seis; teiste konfliktita muudatused (nt staatus) jäävad alles,
 * sest nende baas on endiselt vana.
 */
export function retryBase(base: PageFields, current: PageFields, fields: string[]): PageFields {
  const uus: PageFields = { ...base, comments: [...base.comments], text_annotations: [...base.text_annotations] };
  for (const field of fields) {
    if (field === 'text') {
      // Minu tekst võidab tervikuna → ka annotatsioonikirjed, muidu jääks
      // nende ankruta kirje orvuks (#612).
      uus.text_content = current.text_content;
      uus.text_annotations = [...current.text_annotations];
    } else if (field === 'status') {
      uus.status = current.status;
    } else if (field === 'page_tags') {
      uus.page_tags = current.page_tags;
    } else if (field.startsWith('comments:')) {
      asendaIdJargi(uus.comments, current.comments, field.slice('comments:'.length));
    } else if (field.startsWith('annotations:')) {
      asendaIdJargi(uus.text_annotations, current.text_annotations, field.slice('annotations:'.length));
    }
  }
  return uus;
}

/** Baasi kirje id järgi = serveri oma (või eemaldatud, kui serveris pole). */
function asendaIdJargi<T extends { id: string | number }>(baas: T[], serveri: T[], id: string): void {
  const serveris = serveri.find(c => String(c.id) === id);
  const i = baas.findIndex(c => String(c.id) === id);
  if (serveris && i >= 0) baas[i] = serveris;
  else if (serveris) baas.push(serveris);
  else if (i >= 0) baas.splice(i, 1);
}

/**
 * Väikseim asendus `vana` → `uus` (ühine algus ja lõpp jäävad puutumata), et
 * CodeMirror kaardiks kursori õigesti, kui server liitis teise toimetaja read
 * (#612) — täisasendus viskaks kursori teksti lõppu või algusesse.
 */
export function minimalTextChange(vana: string, uus: string): { from: number; to: number; insert: string } {
  let algus = 0;
  const max = Math.min(vana.length, uus.length);
  while (algus < max && vana.charCodeAt(algus) === uus.charCodeAt(algus)) algus++;
  let lõpp = 0;
  while (lõpp < max - algus && vana.charCodeAt(vana.length - 1 - lõpp) === uus.charCodeAt(uus.length - 1 - lõpp)) lõpp++;
  return { from: algus, to: vana.length - lõpp, insert: uus.slice(algus, uus.length - lõpp) };
}
