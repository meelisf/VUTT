import { describe, it, expect } from 'vitest';
import { buildPickerEntries, matchesQuery } from '../pickerEntries';
import { CollectionTreeNode } from '../../services/collectionService';
import { WorkSetSummary } from '../../services/workSetService';

const node = (id: string, et: string, children: CollectionTreeNode[] = []): CollectionTreeNode =>
  ({ id, collection: { name: { et, en: et } }, children } as unknown as CollectionTreeNode);

const TREE: CollectionTreeNode[] = [
  node('universitas', 'Rootsi aja ülikool', [
    node('academia-gustaviana', 'Academia Gustaviana'),
    node('klingeriana', 'Klingeriana'),
  ]),
  node('vennastekogudus', 'Vennastekoguduse materjalid'),
];

const SETS: WorkSetSummary[] = [
  { id: 'ws_1', name: { et: 'Fischeri konverents 2027', en: 'Fischer conference 2027' },
    visibility: 'members', status: 'active', revision: 1, can_manage: false },
  { id: 'ws_2', name: { et: 'Klingeri seminar', en: 'Klinger seminar' },
    visibility: 'members', status: 'active', revision: 1, can_manage: true },
  { id: 'ws_vana', name: { et: 'Lõppenud projekt', en: 'Finished project' },
    visibility: 'members', status: 'archived', revision: 1, can_manage: true },
];

describe('buildPickerEntries', () => {
  it('tagastab tühja otsinguga mõlemad jaotised muutmata', () => {
    const r = buildPickerEntries(TREE, SETS, '', 'et');
    expect(r.permanent).toHaveLength(2);
    expect(r.workSets.map(ws => ws.id)).toEqual(['ws_1', 'ws_2']);
  });

  it('arhiveeritud kogu ei ole loendis', () => {
    const r = buildPickerEntries(TREE, SETS, '', 'et');
    expect(r.workSets.find(ws => ws.id === 'ws_vana')).toBeUndefined();
  });

  it('otsing filtreerib mõlemat jaotist korraga', () => {
    const r = buildPickerEntries(TREE, SETS, 'kling', 'et');
    expect(r.workSets.map(ws => ws.id)).toEqual(['ws_2']);
    // Püsikogu: vanem jääb alles, sest tal on vastav laps
    expect(r.permanent).toHaveLength(1);
    expect(r.permanent[0].children.map(c => c.id)).toEqual(['klingeriana']);
  });

  it('vanema vaste hoiab lapsed alles', () => {
    const r = buildPickerEntries(TREE, SETS, 'rootsi', 'et');
    expect(r.permanent[0].children).toHaveLength(2);
  });

  it('otsing on tõusutundetu ja arvestab teist keelt', () => {
    expect(buildPickerEntries(TREE, SETS, 'FISCHER', 'en').workSets.map(w => w.id))
      .toEqual(['ws_1']);
  });

  it('töökollektsioonid on nime järgi, võrdse nime korral ID järgi', () => {
    const sama: WorkSetSummary[] = [
      { ...SETS[0], id: 'ws_b', name: { et: 'Sama', en: 'Same' } },
      { ...SETS[0], id: 'ws_a', name: { et: 'Sama', en: 'Same' } },
      { ...SETS[0], id: 'ws_c', name: { et: 'Aaa', en: 'Aaa' } },
    ];
    expect(buildPickerEntries([], sama, '', 'et').workSets.map(w => w.id))
      .toEqual(['ws_c', 'ws_a', 'ws_b']);
  });

  it('vasteta otsing annab mõlemas jaotises tühja, mitte kõike', () => {
    const r = buildPickerEntries(TREE, SETS, 'xyzzy', 'et');
    expect(r.permanent).toEqual([]);
    expect(r.workSets).toEqual([]);
  });
});

describe('matchesQuery', () => {
  it('tühi päring sobib kõigega', () => {
    expect(matchesQuery({ et: 'Ükskõik', en: '' }, '', 'et')).toBe(true);
  });

  it('langeb teise keele peale tagasi, kui valitud keeles nime ei ole', () => {
    expect(matchesQuery({ et: '', en: 'Fischer' }, 'fisch', 'et')).toBe(true);
  });
});
