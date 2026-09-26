// src/pages/manage/partsModel.ts
/** Teose osade kasutajaliidese puhas mudel (#464). */
import type { PartCreator, PartInput, PartKind, PartPlace, WorkPart } from '../../services/workPartsApi';
import type { WorkDating } from '../../utils/workDating';

export interface Badge { partId: string; index: number; kind: PartKind; }

export function sortParts(parts: WorkPart[], stems: string[]): WorkPart[] {
  const pos = new Map(stems.map((s, i) => [s, i]));
  const first = (p: WorkPart) => Math.min(...p.pages.map(s => pos.get(s) ?? Infinity), Infinity);
  return [...parts].sort((a, b) => first(a) - first(b) || a.id.localeCompare(b.id));
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
}

export const emptyDraft = (kind: PartKind = 'letter'): PartDraft => ({
  kind, title: '', incipit: '', datingText: '', dating: null, place: null, place_to: null,
  creators: [], attached_to: null, notes: '',
});

export function draftFromPart(p: WorkPart): PartDraft {
  return {
    kind: p.kind, title: p.title ?? '', incipit: p.incipit ?? '',
    datingText: p.dating?.source_text ?? p.dating?.start ?? '', dating: p.dating ?? null,
    place: p.place ?? null, place_to: p.place_to ?? null, creators: p.creators ?? [],
    attached_to: p.attached_to ?? null, notes: p.notes ?? '',
  };
}

export function partFromDraft(d: PartDraft, pages: string[]): PartInput {
  const out: PartInput = { kind: d.kind, pages, creators: d.creators.filter(c => c.id || c.name), attached_to: d.kind === 'attachment' ? d.attached_to : null };
  if (d.title.trim()) out.title = d.title.trim();
  if (d.incipit.trim()) out.incipit = d.incipit.trim();
  if (d.notes.trim()) out.notes = d.notes.trim();
  if (d.dating) out.dating = d.dating;
  if (d.place) out.place = d.place;
  if (d.place_to && d.kind === 'letter') out.place_to = d.place_to;
  return out;
}
