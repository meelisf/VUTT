import { describe, it, expect } from 'vitest';
import { isVuttId } from '../../../../utils/qcodeUtils';
import { filterPersonTags } from '../useQCodeMaps';

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
