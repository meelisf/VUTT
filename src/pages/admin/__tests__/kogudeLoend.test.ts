import { describe, expect, it } from 'vitest';
import { buildKoguRows, tyypFromParam } from '../kogudeLoend';
import { WorkSetSummary } from '../../../services/workSetService';

const KOGUD = {
  juur: { name: { et: 'Juurkogu', en: 'Root' }, visibility: 'public' as const },
  laps: { name: { et: 'Lapskogu', en: 'Child' }, parent: 'juur', visibility: 'restricted' as const },
  ruhm: { name: { et: 'Rühm', en: 'Group' }, type: 'virtual_group' as const },
};

// Ainult buildKoguRows'i loetavad väljad; ülejäänud WorkSetSummary väljad ei
// puutu siia asjasse.
const KOGUMID = [
  { id: 's1', name: { et: 'Vennastekogudus', en: 'Moravian' }, status: 'active' },
  { id: 's2', name: { et: 'Arhiveeritud', en: 'Archived' }, status: 'archived' },
] as unknown as WorkSetSummary[];

describe('buildKoguRows', () => {
  it('hierarhia säilib: laps tuleb vanema järel ja on sügavamal', () => {
    const read = buildKoguRows(KOGUD, [], { tyyp: 'collections', q: '' }, 'et');
    const idd = read.map(r => r.id);
    expect(idd.indexOf('laps')).toBe(idd.indexOf('juur') + 1);
    expect(read.find(r => r.id === 'laps')!.depth).toBe(1);
    expect(read.find(r => r.id === 'juur')!.depth).toBe(0);
  });

  it('tüübifilter eraldab mudelid', () => {
    expect(buildKoguRows(KOGUD, KOGUMID, { tyyp: 'work_sets', q: '' }, 'et')
      .every(r => r.kind === 'work_set')).toBe(true);
    expect(buildKoguRows(KOGUD, KOGUMID, { tyyp: 'collections', q: '' }, 'et')
      .every(r => r.kind === 'collection')).toBe(true);
    expect(buildKoguRows(KOGUD, KOGUMID, { tyyp: 'all', q: '' }, 'et')).toHaveLength(5);
  });

  it('otsing on diakriitikatundetu ja käib kuvatava nime järgi', () => {
    const read = buildKoguRows(KOGUD, KOGUMID, { tyyp: 'all', q: 'ruhm' }, 'et');
    expect(read.map(r => r.id)).toEqual(['ruhm']);
  });

  it('otsing lamendab hierarhia: vaste ilma vanemata on depth 0', () => {
    // Muidu ripuks „Lapskogu" tühjas õhus taande all, mille vanemat ei kuvata.
    const read = buildKoguRows(KOGUD, [], { tyyp: 'all', q: 'laps' }, 'et');
    expect(read).toHaveLength(1);
    expect(read[0].depth).toBe(0);
  });

  it('keel valib kuvanime, puuduv langeb eesti keelele', () => {
    const [juur] = buildKoguRows(KOGUD, [], { tyyp: 'collections', q: 'root' }, 'en');
    expect(juur.name).toBe('Root');
  });

  it('töökollektsiooni arhiveeritud staatus tuleb kaasa', () => {
    const read = buildKoguRows({}, KOGUMID, { tyyp: 'work_sets', q: '' }, 'et');
    expect(read.find(r => r.id === 's2')!.archived).toBe(true);
    expect(read.find(r => r.id === 's1')!.archived).toBe(false);
  });
});

describe('tyypFromParam', () => {
  it('tundmatu väärtus tähendab „kõik", mitte tühja loendit', () => {
    expect(tyypFromParam('jama')).toBe('all');
    expect(tyypFromParam(null)).toBe('all');
    expect(tyypFromParam('work_sets')).toBe('work_sets');
  });
});
