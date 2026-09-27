// src/prosopography/utils/personWorks.ts
/**
 * Isikulehe „Seotud teosed" (#464): üks rida teose kohta, osa rollid selle all.
 * Kirjed tulevad person_to_works-ist; osa-kirjel on `part_id` ja server lisab `part`.
 */
export interface PartSummary {
  kind: string;
  title: string;
  year: number | null;
  first_page: number | null;
  pages: number[];
}

export interface PersonWorkEntry {
  work_id: string;
  role: string;
  pages?: number[];
  part_id?: string;
  part?: PartSummary;
}

export interface PersonWorkPart { part_id: string; roles: string[]; part?: PartSummary; }

export interface PersonWorkGroup {
  work_id: string;
  /** Teose tasandi rollid (osa rollid on `parts` all). */
  roles: string[];
  /** Teose rea sihtleht: mainimise esimene leht, muidu 1. */
  page: number;
  parts: PersonWorkPart[];
}

/** Rühmitab kirjed teose kaupa, säilitades teoste järjekorra (esimene esinemine). */
export function groupPersonWorks(entries: PersonWorkEntry[]): PersonWorkGroup[] {
  const groups = new Map<string, PersonWorkGroup>();
  for (const e of entries) {
    if (!e.work_id) continue;
    let g = groups.get(e.work_id);
    if (!g) {
      g = { work_id: e.work_id, roles: [], page: 1, parts: [] };
      groups.set(e.work_id, g);
    }
    if (e.part_id) {
      let p = g.parts.find(x => x.part_id === e.part_id);
      if (!p) {
        p = { part_id: e.part_id, roles: [], part: e.part };
        g.parts.push(p);
      }
      if (!p.roles.includes(e.role)) p.roles.push(e.role);
    } else {
      if (!g.roles.includes(e.role)) g.roles.push(e.role);
      if (e.pages?.length && g.page === 1) g.page = e.pages[0];
    }
  }
  for (const g of groups.values()) {
    g.parts.sort((a, b) => (a.part?.first_page ?? Infinity) - (b.part?.first_page ?? Infinity));
  }
  return [...groups.values()];
}
