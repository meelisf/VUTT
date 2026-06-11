// src/utils/__tests__/marginaliaUtils.test.ts
import { describe, it, expect } from 'vitest';
import { findMarginaliaBlocks } from '../marginaliaUtils';

describe('findMarginaliaBlocks', () => {
  it('leiab omaette real seisva ploki ja ankurdab järgmise rea külge', () => {
    const text = 'rida üks\n<m>Apoc. 12.</m>\nrida kaks';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(text.slice(b.from, b.to)).toBe('<m>Apoc. 12.</m>');
    expect(text.slice(b.contentFrom, b.contentTo)).toBe('Apoc. 12.');
    // peidetav ala: ploki rida koos lõpu reavahetusega
    expect(text.slice(b.hideFrom, b.hideTo)).toBe('<m>Apoc. 12.</m>\n');
    // ankur: 'rida kaks' algus
    expect(b.anchorPos).toBe(text.indexOf('rida kaks'));
  });

  it('leiab mitmerealise ploki', () => {
    const text = 'a\n<m>Vide Pic⸗\nrium in</m>\nb';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(text.slice(blocks[0].contentFrom, blocks[0].contentTo)).toBe('Vide Pic⸗\nrium in');
    expect(blocks[0].anchorPos).toBe(text.indexOf('b'));
  });

  it('jätab vahele rea keskel oleva <m> tägi', () => {
    const text = 'tekst <m>inline</m> jätkub';
    expect(findMarginaliaBlocks(text)).toHaveLength(0);
  });

  it('dokumendi lõpus olev plokk ankurdub eelmise rea külge', () => {
    const text = 'viimane rida\n<m>märkus</m>';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(1);
    // peidetav ala sisaldab EELNEVAT reavahetust (lõpus pole oma)
    expect(text.slice(blocks[0].hideFrom, blocks[0].hideTo)).toBe('\n<m>märkus</m>');
    expect(blocks[0].anchorPos).toBe(0); // 'viimane rida' algus
  });

  it('järjestikused plokid: ankur hüppab üle teise peidetud ploki', () => {
    const text = '<m>üks</m>\n<m>kaks</m>\ntekst';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(2);
    const textPos = text.indexOf('tekst');
    expect(blocks[0].anchorPos).toBe(textPos);
    expect(blocks[1].anchorPos).toBe(textPos);
  });

  it('tühi tekst', () => {
    expect(findMarginaliaBlocks('')).toHaveLength(0);
  });
});

import { stackMarginalia } from '../marginaliaUtils';

describe('stackMarginalia', () => {
  it('kattumiseta plokid jäävad oma ankru kõrgusele', () => {
    const out = stackMarginalia([
      { anchorTop: 0, height: 20 },
      { anchorTop: 100, height: 20 },
    ]);
    expect(out).toEqual([
      { top: 0, offset: 0 },
      { top: 100, offset: 0 },
    ]);
  });

  it('kattuv plokk nihkub eelmise alla (gap 6)', () => {
    const out = stackMarginalia([
      { anchorTop: 0, height: 90 },
      { anchorTop: 50, height: 20 },
    ]);
    expect(out[1]).toEqual({ top: 96, offset: 46 });
  });

  it('mitu järjestikust konflikti kuhjuvad', () => {
    const out = stackMarginalia([
      { anchorTop: 0, height: 50 },
      { anchorTop: 10, height: 50 },
      { anchorTop: 20, height: 50 },
    ]);
    expect(out[1].top).toBe(56);
    expect(out[2].top).toBe(112);
  });

  it('tühi sisend', () => {
    expect(stackMarginalia([])).toEqual([]);
  });
});
