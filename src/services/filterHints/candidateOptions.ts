/**
 * Kandidaat rakendatud otsinguvalikutena — SAMA reegel, mis vastuvõtul
 * (applyWorkFilter / setYearStart+End): žanr ja tüüp asendavad (avalehel
 * üksikvalik), märksõna lisandub, aasta seab ys = ye. Loendur peab
 * arvutama just selle päringu, mis vastuvõtu järel jookseb.
 */
import type { DashboardSearchOptions } from '../searchService';
import type { HintKind } from './detectFilterHints';

export function withCandidate(base: DashboardSearchOptions, c: { kind: HintKind; value: string }): DashboardSearchOptions {
  switch (c.kind) {
    case 'year': return { ...base, yearStart: c.value, yearEnd: c.value };
    case 'genre': return { ...base, genre: [c.value] };
    case 'type': return { ...base, type: [c.value] };
    case 'tag': return { ...base, teoseTags: [...(base.teoseTags || []), c.value] };
  }
}
