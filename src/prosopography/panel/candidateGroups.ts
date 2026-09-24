/**
 * Kandidaadid = identiteedid (spekk §6): viited, mis üksteisele viitavad
 * (Wikidata P227/P214, GND sameAs, VIAF lingid), on üks rida. Nime järgi EI
 * ühendata — vale ühendamine on halvem kui kaks rida.
 */
import type { CandidateGroup, CandidateResult, SourceScheme } from './types';

const võti = (s: string, id: string) => `${s}:${id}`;

export function groupCandidates(results: CandidateResult[]): CandidateGroup[] {
  const vanem = new Map<string, string>();
  const leia = (k: string): string => {
    while (vanem.get(k) !== k) {
      const v = vanem.get(k)!;
      vanem.set(k, vanem.get(v)!);
      k = v;
    }
    return k;
  };
  const ühenda = (a: string, b: string) => {
    if (!vanem.has(a)) vanem.set(a, a);
    if (!vanem.has(b)) vanem.set(b, b);
    const ra = leia(a), rb = leia(b);
    if (ra !== rb) vanem.set(rb, ra);
  };
  for (const r of results) {
    const k = võti(r.scheme, r.id);
    if (!vanem.has(k)) vanem.set(k, k);
    for (const [s, id] of Object.entries(r.summary?.links ?? {})) {
      if (id) ühenda(k, võti(s, id));
    }
  }
  const grupid = new Map<string, CandidateGroup>();
  for (const r of results) {
    const juur = leia(võti(r.scheme, r.id));
    let g = grupid.get(juur);
    if (!g) {
      g = { key: võti(r.scheme, r.id), members: [], ids: {}, existingPersonIds: [] };
      grupid.set(juur, g);
    }
    g.members.push(r);
    g.ids[r.scheme as SourceScheme] ??= r.id;
    for (const [s, id] of Object.entries(r.summary?.links ?? {})) {
      if (id) g.ids[s as SourceScheme] ??= id;
    }
    if (r.existing_person_id && !g.existingPersonIds.includes(r.existing_person_id)) {
      g.existingPersonIds.push(r.existing_person_id);
    }
  }
  return [...grupid.values()];
}
