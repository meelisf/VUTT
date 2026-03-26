import { describe, it, expect } from 'vitest';
import { isVuttId } from '../../../../utils/qcodeUtils';
import { filterPersonTags, buildAvailablePersonTags } from '../useQCodeMaps';

describe('isVuttId', () => {
  it('tuvastab vutt:P prefixiga ID', () => {
    expect(isVuttId('vutt:Pabc123')).toBe(true);
    expect(isVuttId('vutt:Pxmnuan')).toBe(true);
  });
  it('ei tunne ära Q-koode', () => {
    expect(isVuttId('Q12345')).toBe(false);
    expect(isVuttId('vutt:Wabc')).toBe(false);
    expect(isVuttId('')).toBe(false);
  });
});

describe('filterPersonTags', () => {
  const tagsIdMap = {
    'Q151616': 'Põhjasõda',
    'vutt:Pxmnuan': 'Karl XII',
    'vutt:P1pz2xc': 'Mõni isik',
    'Q413': 'Füüsika',
  };

  it('tagastab ainult vutt:P isikud', () => {
    const result = filterPersonTags(tagsIdMap);
    expect(result).toEqual([
      { id: 'vutt:Pxmnuan', label: 'Karl XII' },
      { id: 'vutt:P1pz2xc', label: 'Mõni isik' },
    ]);
  });

  it('tagastab tühja massiivi kui isikuid pole', () => {
    expect(filterPersonTags({ 'Q413': 'Füüsika' })).toEqual([]);
  });

  it('tagastab tühja massiivi tühja kaardi korral', () => {
    expect(filterPersonTags({})).toEqual([]);
  });
});

describe('buildAvailablePersonTags', () => {
  const personTagsFromLoad = [
    { id: 'vutt:Pen9x7r', label: 'Gustav II Adolf' },
    { id: 'vutt:Pxmnuan', label: 'Karl XII' },
    { id: 'vutt:Pabc123', label: 'adam Adamson' },
  ];

  it('kasutab prosopograafia API andmeid kui otsingutulemustes pole isikuid', () => {
    const tagsIdMap = { 'Q413': 'Füüsika' };
    const result = buildAvailablePersonTags(tagsIdMap, personTagsFromLoad, 'et');
    expect(result).toEqual([
      { id: 'vutt:Pabc123', label: 'Adam Adamson' }, // cap() rakendatud
      { id: 'vutt:Pen9x7r', label: 'Gustav II Adolf' },
      { id: 'vutt:Pxmnuan', label: 'Karl XII' },
    ]);
  });

  it('eelistab otsingutulemustest leitud isikuid API andmetele', () => {
    const tagsIdMap = {
      'vutt:Pxmnuan': 'Karl XII (otsingutest)',
      'Q413': 'Füüsika',
    };
    const result = buildAvailablePersonTags(tagsIdMap, personTagsFromLoad, 'et');
    expect(result).toEqual([
      { id: 'vutt:Pxmnuan', label: 'Karl XII (otsingutest)' },
    ]);
  });

  it('tagastab tühja massiivi kui mõlemad allikad on tühjad', () => {
    expect(buildAvailablePersonTags({}, [], 'et')).toEqual([]);
  });

  it('sordib isikud labeli järgi tähestikuliselt', () => {
    const tags = [
      { id: 'vutt:P3', label: 'Zebra' },
      { id: 'vutt:P1', label: 'Anna' },
      { id: 'vutt:P2', label: 'Mihkel' },
    ];
    const result = buildAvailablePersonTags({}, tags, 'et');
    expect(result.map(p => p.label)).toEqual(['Anna', 'Mihkel', 'Zebra']);
  });

  it('/prosopography vastuse parsimine — filtreerib ainult vutt:P ID-d', () => {
    // Simuleerib API vastust: {results: [{id, label, ...}]}
    const apiResults = [
      { id: 'vutt:Pen9x7r', label: 'Gustav II Adolf' },
      { id: 'vutt:Pxmnuan', label: 'Karl XII' },
    ].filter(p => isVuttId(p.id)).map(p => ({ id: p.id, label: p.label }));
    expect(apiResults).toHaveLength(2);
    expect(apiResults[0]).toEqual({ id: 'vutt:Pen9x7r', label: 'Gustav II Adolf' });
  });
});
