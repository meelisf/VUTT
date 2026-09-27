import { describe, it, expect } from 'vitest';
import { matchRegistry, sourceFormAfterPick } from '../registryMatch';

const REG = {
  'academia-gustavo-carolina': { id: 'Q138710754', labels: { et: 'Academia Gustavo-Carolina', en: 'Academia Gustavo-Carolina' }, variants: ['AGC'], place_key: 'Dorpat' },
  'uppsala-universitet': { id: 'Q185246', labels: { et: 'Uppsala ülikool', en: 'Uppsala University' }, variants: ['Uppsala', 'Univ. Uppsala', 'Upsala'] },
  'abo-akademi': { id: null, labels: { et: 'Turu Akadeemia' }, variants: ['Åbo', 'Univ. Åbo'] },
};

describe('matchRegistry', () => {
  it('leiab nimevariandi järgi; täpne vaste enne osalist', () => {
    const hits = matchRegistry(REG, 'agc', 'et');
    expect(hits.map(h => h.key)).toEqual(['academia-gustavo-carolina']);
    expect(hits[0].matched).toBe('AGC');
    expect(matchRegistry(REG, 'upsala', 'et')[0].key).toBe('uppsala-universitet');
  });

  it('diakriitikud ei sega: „abo" leiab „Åbo"', () => {
    expect(matchRegistry(REG, 'abo', 'et').map(h => h.key)).toEqual(['abo-akademi']);
  });

  it('silt keele järgi; alla 2 märgi ei otsi', () => {
    expect(matchRegistry(REG, 'upps', 'en')[0].label).toBe('Uppsala University');
    expect(matchRegistry(REG, 'u', 'et')).toEqual([]);
  });
});

describe('sourceFormAfterPick', () => {
  const [agc] = matchRegistry(REG, 'agc', 'et');
  const [upp] = matchRegistry(REG, 'upps', 'et');

  it('trükitud nimevariant on allika kuju', () => {
    expect(sourceFormAfterPick('', 'AGC', agc)).toBe('AGC');
    expect(sourceFormAfterPick('vana', 'Univ. Uppsala', upp)).toBe('Univ. Uppsala');
  });

  it('poolik päring ei saa allika kujuks: varasem kuju jääb, tühjal real registri silt', () => {
    expect(sourceFormAfterPick('Lyz. Upsal.', 'upps', upp)).toBe('Lyz. Upsal.');
    expect(sourceFormAfterPick('', 'upps', upp)).toBe('Uppsala ülikool');
  });
});
