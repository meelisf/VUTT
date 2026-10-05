// src/pages/manage/partsModel.ts
/** Teose osade kasutajaliidese puhas mudel (#464). */
import type { PartCreator, PartInput, PartKind, PartPlace, WorkPart } from '../../services/workPartsApi';
import { parseDatingText, type WorkDating } from '../../utils/workDating';

export interface Badge { partId: string; index: number; kind: PartKind; }

export function sortParts(parts: WorkPart[], stems: string[]): WorkPart[] {
  const pos = new Map(stems.map((s, i) => [s, i]));
  const first = (p: WorkPart) => Math.min(...p.pages.map(s => pos.get(s) ?? Infinity), Infinity);
  return [...parts].sort((a, b) => first(a) - first(b) || a.id.localeCompare(b.id));
}

/** Osa lehed lehenumbrite vahemikena (järjestikused kokku); kadunud tüvi jääb välja. */
export function pageRangeList(pageStems: string[], pageNums: Map<string, number>): { from: number; to: number }[] {
  return numberRangeList(pageStems.map(s => pageNums.get(s)).filter((n): n is number => n !== undefined));
}

function numberRangeList(values: number[]): { from: number; to: number }[] {
  const nums = [...new Set(values)].sort((a, b) => a - b);
  const out: { from: number; to: number }[] = [];
  for (let i = 0; i < nums.length; i++) {
    const from = nums[i];
    while (i + 1 < nums.length && nums[i + 1] === nums[i] + 1) i++;
    out.push({ from, to: nums[i] });
  }
  return out;
}

const rangesText = (ranges: { from: number; to: number }[]) =>
  ranges.map(r => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`)).join(', ');

/** Sama tekstina: „1–3, 9". */
export function pageRanges(pageStems: string[], pageNums: Map<string, number>): string {
  return rangesText(pageRangeList(pageStems, pageNums));
}

/** Leheküljenumbrid tekstina: [7, 8, 9, 11] → „7–9, 11". */
export function compactNumbers(nums: number[]): string {
  return rangesText(numberRangeList(nums));
}

export function pageBadges(parts: WorkPart[], stems: string[]): Map<string, Badge[]> {
  const out = new Map<string, Badge[]>();
  sortParts(parts, stems).forEach((p, i) => {
    for (const s of p.pages) {
      if (!out.has(s)) out.set(s, []);
      out.get(s)!.push({ partId: p.id, index: i + 1, kind: p.kind });
    }
  });
  return out;
}

export function sharedStems(part: WorkPart, parts: WorkPart[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of part.pages) {
    const others = parts.filter(o => o.id !== part.id && o.pages.includes(s)).map(o => o.id);
    if (others.length) out.set(s, others);
  }
  return out;
}

export interface PartDraft {
  kind: PartKind; title: string; incipit: string; datingText: string; dating: WorkDating | null;
  place: PartPlace | null; place_to: PartPlace | null; creators: PartCreator[]; attached_to: string | null; notes: string;
  abstract_et: string; abstract_en: string;
  /** Serveri ankur (loetav, mitte saadetav) ja selle salvestuse kinnitus. */
  abstractAnchor: string | null; confirmEn: boolean;
  /** Väljad, mida vorm ei tunne (nt languages, tulevased väljad). Server asendab PUT-il
   *  terve osa — ilma selleta kaoksid need vaikselt. */
  extra: Record<string, unknown>;
}

const FORM_FIELDS = new Set(['id', 'kind', 'pages', 'title', 'incipit', 'dating', 'place', 'place_to',
  'creators', 'attached_to', 'notes', 'needs_review', 'abstract_et', 'abstract_en', 'abstract_en_src']);

export const emptyDraft = (kind: PartKind = 'letter'): PartDraft => ({
  kind, title: '', incipit: '', datingText: '', dating: null, place: null, place_to: null,
  creators: [], attached_to: null, notes: '', abstract_et: '', abstract_en: '', abstractAnchor: null, confirmEn: false,
  extra: {},
});

export function draftFromPart(p: WorkPart): PartDraft {
  return {
    kind: p.kind, title: p.title ?? '', incipit: p.incipit ?? '',
    datingText: p.dating?.source_text ?? p.dating?.start ?? '', dating: p.dating ?? null,
    place: p.place ?? null, place_to: p.place_to ?? null, creators: p.creators ?? [],
    attached_to: p.attached_to ?? null, notes: p.notes ?? '',
    abstract_et: p.abstract_et ?? '', abstract_en: p.abstract_en ?? '',
    abstractAnchor: p.abstract_en_src ?? null, confirmEn: false,
    extra: Object.fromEntries(Object.entries(p).filter(([k]) => !FORM_FIELDS.has(k))),
  };
}

/** Dateeringu tekst, millest ei saa kuupäeva: osal pole teksti-välja (erinevalt teose
 *  `year_display`-st), seega ei tohi seda vaikselt maha visata — salvestus peatub. */
export class PartDatingError extends Error {}

/** Lihtsasse lahtrisse kirjutatud „1667" jääb mustandis tekstiks (`dating` = null);
 *  enne saatmist tõlgendatakse see struktureeritud dateeringuks. */
function draftDating(d: PartDraft): WorkDating | null {
  if (d.dating) return d.dating;
  const text = d.datingText.trim();
  if (!text) return null;
  const parsed = parseDatingText(text);
  if (!parsed) throw new PartDatingError(text);
  return parsed;
}

export function partFromDraft(d: PartDraft, pages: string[]): PartInput {
  const out: PartInput = { ...(d.extra ?? {}), kind: d.kind, pages, creators: d.creators.filter(c => c.id || c.name), attached_to: d.kind === 'attachment' ? d.attached_to : null };
  if (d.title.trim()) out.title = d.title.trim();
  if (d.incipit.trim()) out.incipit = d.incipit.trim();
  if (d.notes.trim()) out.notes = d.notes.trim();
  if (d.abstract_et.trim()) out.abstract_et = d.abstract_et.trim();
  if (d.abstract_en.trim()) out.abstract_en = d.abstract_en.trim();
  if (d.confirmEn && d.abstract_en.trim()) out.confirm_abstract_translation = true;
  const dating = draftDating(d);
  if (dating) out.dating = dating;
  if (d.place) out.place = d.place;
  if (d.place_to && d.kind === 'letter') out.place_to = d.place_to;
  return out;
}

export type ManageTab = 'parts' | 'pages' | 'trash' | 'replace';

/** Vaikimisi „Leheküljed": osi läheb harvem vaja, ja töölaua sügavlink `?focus=N`
 *  (utils/manageDeeplink) vajab niikuinii lehtede vahekaarti. */
export function initialManageTab(_focus: number | null): ManageTab {
  return 'pages';
}

/** Vahekaardi vahetust kaitstakse ainult osade mustandi korral: järjekorra ja lehetoimingute
 *  mustand elab WorkManage'is ning jääb vahetusel alles — seal poleks „Loobu" tõene. */
export function tabSwitch(partsDirty: boolean, runGuarded: (fn: () => void) => void, fn: () => void): void {
  if (partsDirty) runGuarded(fn);
  else fn();
}

/** Avalik kokkuvõte lugeja keeles; puudumisel teises keeles koos keelemärgiga (ADR 0063). */
export function partAbstract(p: Pick<WorkPart, 'abstract_et' | 'abstract_en'>, lang: string):
  { text: string; otherLang: 'et' | 'en' | null } | null {
  const own = lang === 'en' ? p.abstract_en : p.abstract_et;
  if (own?.trim()) return { text: own, otherLang: null };
  const otherLang = lang === 'en' ? 'et' : 'en';
  const other = otherLang === 'en' ? p.abstract_en : p.abstract_et;
  return other?.trim() ? { text: other, otherLang } : null;
}
