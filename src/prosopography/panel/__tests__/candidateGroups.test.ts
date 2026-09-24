import { describe, it, expect } from 'vitest';
import { groupCandidates } from '../candidateGroups';
import type { CandidateResult, SourceScheme } from '../types';

const r = (scheme: SourceScheme, id: string, links = {}, existing: string | null = null): CandidateResult => ({
  scheme, id, ok: true, error: null, existing_person_id: existing,
  summary: { label: id, names: [], description: null, birth: { date: null, precision: null, place: null },
             death: { date: null, precision: null, place: null }, occupations: [], url: '', links },
});

describe('groupCandidates', () => {
  it('seotud ID-d ühendavad kolm allikat üheks', () => {
    const g = groupCandidates([r('wikidata', 'Q1', { gnd: '2', viaf: '3' }), r('gnd', '2'), r('viaf', '3')]);
    expect(g).toHaveLength(1);
    expect(g[0].ids).toEqual({ wikidata: 'Q1', gnd: '2', viaf: '3' });
  });
  it('ühendamine töötab ka kaudselt (GND → WD, VIAF → GND)', () => {
    const g = groupCandidates([r('gnd', '2', { wikidata: 'Q1' }), r('viaf', '3', { gnd: '2' }), r('wikidata', 'Q1')]);
    expect(g).toHaveLength(1);
  });
  it('ilma viiteta sama nimi = kaks kandidaati (nime järgi ei ühendata)', () => {
    expect(groupCandidates([r('wikidata', 'Q1'), r('gnd', '2')])).toHaveLength(2);
  });
  it('olemasolevad kaardid kogutakse kordusteta; ebaõnnestunud viide jääb oma grupiks', () => {
    const bad: CandidateResult = { scheme: 'viaf', id: '9', ok: false, summary: null, error: 'timeout', existing_person_id: null };
    const g = groupCandidates([r('wikidata', 'Q1', {}, 'vutt:Pa'), r('gnd', '2', { wikidata: 'Q1' }, 'vutt:Pa'), bad]);
    expect(g[0].existingPersonIds).toEqual(['vutt:Pa']);
    expect(g[1].members[0].ok).toBe(false);
  });
});
